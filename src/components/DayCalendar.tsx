import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { colors, type } from '../theme';
import {
  calendarScrollOffset,
  dayNumber,
  dayWindow,
  formatMinutes,
  monthYearLabel,
  parseMinutes,
  snapMinutes,
  weekdayShort,
} from '../dates';
import type { TaskRecord, TaskTree } from '../models/types';
import { HOLD_DELAY, useDragDrop, type Rect } from './drag/DragDropContext';
import { durationFromPointerDelta, snapDuration } from './drag/geometry';

export const CAL_START_HOUR = 0;
export const CAL_END_HOUR = 24;
export const PX_PER_HOUR = 50;
export const CAL_PX_PER_HOUR = PX_PER_HOUR;
const TIME_AXIS = 22;
const HOURS = Array.from({ length: CAL_END_HOUR - CAL_START_HOUR }, (_, i) => CAL_START_HOUR + i);
const INITIAL_PAST = 30;
const INITIAL_FUTURE = 30;
const CHUNK = 21;

type CalComposer = { iso: string; time: string } | null;

type Props = {
  todayISO: string;
  tasksForDay: (iso: string) => TaskRecord[];
  childrenOf: (id: string) => TaskTree[];
  pixelsPerHour?: number;
  onOpenTask: (id: string) => void;
  onCreateAt: (iso: string, time: string, name: string) => void;
  onSetDuration: (id: string, minutes: number) => void;
};

export function DayCalendar({
  todayISO,
  tasksForDay,
  childrenOf,
  pixelsPerHour = PX_PER_HOUR,
  onOpenTask,
  onCreateAt,
  onSetDuration,
}: Props) {
  const [past, setPast] = useState(INITIAL_PAST);
  const [future, setFuture] = useState(INITIAL_FUTURE);
  const [columnWidth, setColumnWidth] = useState(0);
  const [composer, setComposer] = useState<CalComposer>(null);
  const [draft, setDraft] = useState('');
  const [centerISO, setCenterISO] = useState(todayISO);
  const days = useMemo(() => dayWindow(todayISO, past, future), [todayISO, past, future]);
  const gridHeight = (CAL_END_HOUR - CAL_START_HOUR) * pixelsPerHour;
  const hourScrollRef = useRef<ScrollView>(null);
  const dayScrollRef = useRef<ScrollView>(null);
  const headerScrollRef = useRef<ScrollView>(null);
  const hourWrapRef = useRef<View>(null);
  const dayWrapRef = useRef<View>(null);
  const hourOffset = useRef({ x: 0, y: 0 });
  const dayOffset = useRef({ x: 0, y: 0 });
  const hourViewport = useRef<Rect | null>(null);
  const dayViewport = useRef<Rect | null>(null);
  const expanding = useRef(false);
  const todayIndex = past;
  const focusY = calendarScrollOffset(
    tasksForDay(todayISO).map((task) => task.startTime),
    CAL_START_HOUR,
    pixelsPerHour,
  );
  const centered = useRef(false);
  const { refreshZones, registerScroller } = useDragDrop();

  useEffect(() => {
    const unHour = registerScroller({
      id: 'cal-hours',
      axis: 'y',
      getViewport: () => hourViewport.current,
      getOffset: () => hourOffset.current,
      scrollTo: (next) => {
        hourOffset.current = next;
        hourScrollRef.current?.scrollTo({ y: next.y, animated: false });
      },
    });
    const unDays = registerScroller({
      id: 'cal-days',
      axis: 'x',
      getViewport: () => dayViewport.current,
      getOffset: () => dayOffset.current,
      scrollTo: (next) => {
        dayOffset.current = next;
        dayScrollRef.current?.scrollTo({ x: next.x, animated: false });
        headerScrollRef.current?.scrollTo({ x: next.x, animated: false });
      },
    });
    return () => {
      unHour();
      unDays();
    };
  }, [registerScroller]);

  function measureScroller(ref: { current: View | null }, into: { current: Rect | null }) {
    const node = ref.current as (View & { measureInWindow?: Function }) | null;
    node?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
      into.current = { x, y, width, height };
    });
  }

  useLayoutEffect(() => {
    hourOffset.current = { x: 0, y: focusY };
    hourScrollRef.current?.scrollTo({ y: focusY, animated: false });
    if (columnWidth < 40) return;
    if (centered.current) return;
    dayScrollRef.current?.scrollTo({ x: todayIndex * columnWidth, animated: false });
    headerScrollRef.current?.scrollTo({ x: todayIndex * columnWidth, animated: false });
    centered.current = true;
  }, [columnWidth, focusY, todayIndex]);

  function syncHeader(x: number) {
    headerScrollRef.current?.scrollTo({ x, animated: false });
    const index = Math.round(x / Math.max(columnWidth, 1));
    const iso = days[Math.max(0, Math.min(days.length - 1, index))];
    if (iso && iso !== centerISO) setCenterISO(iso);
  }

  function maybeExpand(x: number) {
    if (expanding.current || columnWidth < 40) return;
    if (x < columnWidth * 6) {
      expanding.current = true;
      setPast((value) => value + CHUNK);
      requestAnimationFrame(() => {
        const nextX = x + CHUNK * columnWidth;
        dayScrollRef.current?.scrollTo({ x: nextX, animated: false });
        headerScrollRef.current?.scrollTo({ x: nextX, animated: false });
        expanding.current = false;
        refreshZones();
      });
      return;
    }
    const maxX = (days.length - 8) * columnWidth;
    if (x > maxX) {
      expanding.current = true;
      setFuture((value) => value + CHUNK);
      expanding.current = false;
    }
  }

  return (
    <View
      style={styles.wrap}
      testID="day-calendar"
      onLayout={(event) => {
        const available = Math.max(160, event.nativeEvent.layout.width - TIME_AXIS);
        const next = Math.round(available * 0.72);
        if (Math.abs(next - columnWidth) > 8) setColumnWidth(next);
      }}
    >
      <Text style={styles.month} testID="calendar-month">
        {monthYearLabel(centerISO)}
      </Text>
      <ScrollView
        ref={headerScrollRef}
        horizontal
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        style={styles.headerScroll}
      >
        <View style={{ width: TIME_AXIS }} />
        {days.map((iso) => {
          const isToday = iso === todayISO;
          return (
            <View key={`h-${iso}`} style={[styles.dayHead, { width: columnWidth }]}>
              <Text style={[styles.dow, isToday && styles.dowToday]}>
                {`${weekdayShort(iso)} ${dayNumber(iso)}`}
              </Text>
            </View>
          );
        })}
      </ScrollView>
      <View
        ref={hourWrapRef}
        style={styles.gridScroll}
        onLayout={() => measureScroller(hourWrapRef, hourViewport)}
      >
      <ScrollView
        ref={hourScrollRef}
        style={styles.fill}
        contentOffset={{ x: 0, y: focusY }}
        onScroll={(event) => {
          hourOffset.current = { x: 0, y: event.nativeEvent.contentOffset.y };
          refreshZones();
        }}
        scrollEventThrottle={16}
      >
        <View style={[styles.gridRow, { height: gridHeight }]}>
          <View style={[styles.axis, { height: gridHeight }]}>
            {HOURS.map((hour) => (
              <Text
                key={hour}
                style={[styles.hourLabel, { height: pixelsPerHour }, hour === 9 && styles.hourLabelMorning]}
              >
                {hour === 0 ? '' : `${hour}`}
              </Text>
            ))}
          </View>
          <View
            ref={dayWrapRef}
            style={styles.fill}
            onLayout={() => measureScroller(dayWrapRef, dayViewport)}
          >
          <ScrollView
            ref={dayScrollRef}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(event) => {
              const x = event.nativeEvent.contentOffset.x;
              dayOffset.current = { x, y: 0 };
              syncHeader(x);
              maybeExpand(x);
              refreshZones();
            }}
            scrollEventThrottle={16}
            testID="calendar-days"
          >
            {days.map((iso) => (
              <DayColumn
                key={iso}
                iso={iso}
                width={columnWidth}
                height={gridHeight}
                pixelsPerHour={pixelsPerHour}
                tasks={tasksForDay(iso)}
                composer={composer?.iso === iso ? composer : null}
                draft={draft}
                onDraft={setDraft}
                onCompose={setComposer}
                onCreate={(time, name) => {
                  onCreateAt(iso, time, name);
                  setComposer(null);
                  setDraft('');
                }}
                onOpenTask={onOpenTask}
                childrenOf={childrenOf}
                onSetDuration={onSetDuration}
              />
            ))}
          </ScrollView>
          </View>
        </View>
      </ScrollView>
      </View>
    </View>
  );
}

function DayColumn({
  iso,
  width,
  height,
  pixelsPerHour,
  tasks,
  composer,
  draft,
  onDraft,
  onCompose,
  onCreate,
  onOpenTask,
  childrenOf,
  onSetDuration,
}: {
  iso: string;
  width: number;
  height: number;
  pixelsPerHour: number;
  tasks: TaskRecord[];
  composer: CalComposer;
  draft: string;
  onDraft: (value: string) => void;
  onCompose: (slot: CalComposer) => void;
  onCreate: (time: string, name: string) => void;
  onOpenTask: (id: string) => void;
  childrenOf: (id: string) => TaskTree[];
  onSetDuration: (id: string, minutes: number) => void;
}) {
  const { registerZone, bestId, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const zoneId = `cal-${iso}`;
  const highlighted = bestId === zoneId;

  useEffect(() => {
    return registerZone({
      id: zoneId,
      target: { kind: 'cal', iso },
      ref,
    });
  }, [iso, registerZone, zoneId]);

  function timeAt(pageY: number, columnY: number) {
    const minutes = ((pageY - columnY) / pixelsPerHour) * 60;
    return formatMinutes(snapMinutes(minutes, 15));
  }

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      testID={`day-column-${iso}`}
      onLayout={() => refreshZones()}
      onPress={(event) => {
        const node = ref.current as (View & { measureInWindow?: Function }) | null;
        node?.measureInWindow?.((_x: number, y: number) => {
          onDraft('');
          onCompose({ iso, time: timeAt(event.nativeEvent.pageY, y) });
        });
      }}
      style={[styles.column, { width, height }, highlighted && styles.columnHot]}
    >
      {HOURS.map((hour) => (
        <View key={hour} style={[styles.hourLine, { top: hour * pixelsPerHour }]} />
      ))}
      {tasks
        .filter((task) => task.startTime)
        .map((task) => (
          <CalBlock
            key={task.id}
            task={task}
            children={childrenOf(task.id)}
            pixelsPerHour={pixelsPerHour}
            onOpenTask={onOpenTask}
            onSetDuration={onSetDuration}
          />
        ))}
      {composer ? (
        <View
          style={[
            styles.calComposer,
            { top: (parseMinutes(composer.time) / 60) * pixelsPerHour },
          ]}
        >
          <TextInput
            autoFocus
            value={draft}
            onChangeText={onDraft}
            placeholder={composer.time}
            placeholderTextColor={colors.faint}
            style={styles.calInput}
            onSubmitEditing={() => {
              const name = draft.trim();
              if (name) onCreate(composer.time, name);
              else onCompose(null);
            }}
            onBlur={() => {
              const name = draft.trim();
              if (name) onCreate(composer.time, name);
              else onCompose(null);
            }}
          />
        </View>
      ) : null}
    </Pressable>
  );
}

function CalBlock({
  task,
  children,
  pixelsPerHour,
  onOpenTask,
  onSetDuration,
}: {
  task: TaskRecord;
  children: TaskTree[];
  pixelsPerHour: number;
  onOpenTask: (id: string) => void;
  onSetDuration: (id: string, minutes: number) => void;
}) {
  const { registerZone, bestId, armDrag, activateDrag, cancelDrag, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const nestId = `nest-cal-${task.id}`;
  const minutes = parseMinutes(task.startTime);
  const top = (minutes / 60) * pixelsPerHour;
  const [preview, setPreview] = useState(0);
  const duration = preview || task.duration;
  const height = Math.max(28, (duration / 60) * pixelsPerHour);
  const highlighted = bestId === nestId;
  const didResize = useRef(false);

  useEffect(() => {
    return registerZone({
      id: nestId,
      target: { kind: 'nest', parentID: task.id },
      ref,
      ownerTaskId: task.id,
    });
  }, [nestId, registerZone, task.id]);

  function startPointerDrag(pageX: number, pageY: number) {
    const nodeView = ref.current as (View & { measureInWindow?: Function }) | null;
    nodeView?.measureInWindow?.((x: number, y: number, width: number, blockHeight: number) => {
      armDrag(task, task.parentID ? 'nested-cal' : 'cal', pageX, pageY, {
        x,
        y,
        width,
        height: blockHeight,
      });
    });
  }

  return (
    <View style={[styles.blockWrap, { top, height }]} pointerEvents="box-none">
      <Pressable
        ref={ref}
        collapsable={false}
        testID={`cal-block-${task.id}`}
        onLayout={() => refreshZones()}
        onPress={() => {
          if (didResize.current) {
            didResize.current = false;
            return;
          }
          onOpenTask(task.id);
        }}
        onLongPress={(event) => {
          startPointerDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
          activateDrag();
        }}
        delayLongPress={HOLD_DELAY}
        onPressIn={(event) => {
          if (Platform.OS === 'web') {
            startPointerDrag(event.nativeEvent.pageX, event.nativeEvent.pageY);
          }
        }}
        style={[styles.block, highlighted && styles.blockHot]}
      >
        {task.imageDownloadURL ? <Image source={{ uri: task.imageDownloadURL }} style={styles.blockPhoto} /> : null}
        <Text style={styles.blockTime}>{task.startTime}</Text>
        <Text style={styles.blockName} numberOfLines={2}>
          {task.name}
        </Text>
        {children.length ? (
          <View pointerEvents="none" style={styles.nestedList} testID={`cal-nested-${task.id}`}>
            {children.map((node) => (
              <CompactTodo key={node.task.id} node={node} depth={0} />
            ))}
          </View>
        ) : null}
      </Pressable>
      <DurationHandle
        taskId={task.id}
        duration={duration}
        pixelsPerHour={pixelsPerHour}
        onStart={() => {
          cancelDrag();
          setPreview(task.duration);
        }}
        onChange={(next) => setPreview(next)}
        onCommit={(next) => {
          didResize.current = true;
          setPreview(0);
          onSetDuration(task.id, snapDuration(next, 15));
        }}
      />
    </View>
  );
}

function CompactTodo({ node, depth }: { node: TaskTree; depth: number }) {
  return (
    <View>
      <View style={[styles.nestedRow, { paddingLeft: depth * 10 }]}>
        <View style={[styles.miniBox, node.task.isDone && styles.miniBoxDone]} />
        <Text numberOfLines={1} style={[styles.nestedName, node.task.isDone && styles.nestedDone]}>
          {node.task.name}
        </Text>
      </View>
      {node.children.map((child) => (
        <CompactTodo key={child.task.id} node={child} depth={depth + 1} />
      ))}
    </View>
  );
}

function DurationHandle({
  taskId,
  duration,
  pixelsPerHour,
  onStart,
  onChange,
  onCommit,
}: {
  taskId: string;
  duration: number;
  pixelsPerHour: number;
  onStart: () => void;
  onChange: (minutes: number) => void;
  onCommit: (minutes: number) => void;
}) {
  const startY = useRef(0);
  const startDur = useRef(duration);
  const active = useRef(false);
  const latest = useRef(duration);
  const handleH = Math.max(8, Math.min(24, (duration * pixelsPerHour) / 60 / 3));

  function begin(pageY: number) {
    active.current = true;
    startY.current = pageY;
    startDur.current = duration;
    latest.current = duration;
    onStart();
  }

  function move(pageY: number) {
    if (!active.current) return;
    const next = durationFromPointerDelta(startDur.current, pageY - startY.current, pixelsPerHour);
    latest.current = next;
    onChange(next);
  }

  function finish() {
    if (!active.current) return;
    active.current = false;
    onCommit(latest.current);
  }

  return (
    <View
      testID={`cal-resize-${taskId}`}
      style={[styles.resizeHandle, { height: handleH }]}
      onStartShouldSetResponder={() => true}
      onMoveShouldSetResponder={() => true}
      onResponderTerminationRequest={() => false}
      onResponderGrant={(event) => begin(event.nativeEvent.pageY)}
      onResponderMove={(event) => move(event.nativeEvent.pageY)}
      onResponderRelease={finish}
      onResponderTerminate={() => {
        active.current = false;
      }}
      {...({
        onPointerDown: (event: {
          stopPropagation?: () => void;
          currentTarget?: { setPointerCapture?: (id: number) => void };
          pointerId?: number;
          nativeEvent?: { pageY?: number; pointerId?: number };
          clientY?: number;
        }) => {
          event.stopPropagation?.();
          const pointerId = event.pointerId ?? event.nativeEvent?.pointerId;
          if (pointerId != null) event.currentTarget?.setPointerCapture?.(pointerId);
          begin(event.nativeEvent?.pageY ?? event.clientY ?? 0);
        },
        onPointerMove: (event: { nativeEvent?: { pageY?: number }; clientY?: number }) => {
          move(event.nativeEvent?.pageY ?? event.clientY ?? 0);
        },
        onPointerUp: finish,
      } as object)}
    />
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  wrap: {
    flex: 1,
    backgroundColor: colors.calBg,
  },
  month: {
    paddingHorizontal: 12,
    paddingTop: 6,
    paddingBottom: 2,
    color: colors.ink,
    fontSize: type.small,
    fontWeight: '600',
  },
  headerScroll: {
    maxHeight: 44,
    flexGrow: 0,
  },
  dayHead: {
    height: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  dow: {
    color: colors.ink,
    fontSize: type.small,
    fontWeight: '600',
  },
  dowToday: {
    color: colors.ink,
    fontWeight: '800',
  },
  gridScroll: {
    flex: 1,
    overflow: 'hidden',
  },
  gridRow: {
    flexDirection: 'row',
  },
  axis: {
    width: TIME_AXIS,
  },
  hourLabel: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 12,
    textAlign: 'right',
    paddingRight: 2,
  },
  hourLabelMorning: {
    color: colors.ink,
    fontWeight: '700',
  },
  column: {
    position: 'relative',
    borderRightWidth: StyleSheet.hairlineWidth,
    borderColor: colors.grid,
  },
  columnHot: {
    backgroundColor: colors.dropPreview,
  },
  hourLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.grid,
  },
  blockWrap: {
    position: 'absolute',
    left: 4,
    right: 4,
    zIndex: 2,
  },
  block: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
  },
  nestedList: {
    marginTop: 4,
    gap: 2,
  },
  nestedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  miniBox: {
    width: 8,
    height: 8,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.ink,
    borderRadius: 1,
  },
  miniBoxDone: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  nestedName: {
    flex: 1,
    color: colors.ink,
    fontSize: 11,
  },
  nestedDone: {
    color: colors.done,
    textDecorationLine: 'line-through',
  },
  resizeHandle: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    transform: [{ translateY: 6 }],
    zIndex: 4,
  },
  blockHot: {
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
    backgroundColor: colors.dropPreview,
  },
  blockTime: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
  },
  blockName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
  },
  blockPhoto: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    borderRadius: 8,
    opacity: 0.35,
  },
  calComposer: {
    position: 'absolute',
    left: 4,
    right: 4,
    height: 32,
    zIndex: 5,
    borderWidth: 2,
    borderColor: colors.composer,
    borderRadius: 6,
    backgroundColor: colors.card,
  },
  calInput: {
    flex: 1,
    paddingHorizontal: 8,
    color: colors.ink,
    fontSize: type.small,
  },
});
