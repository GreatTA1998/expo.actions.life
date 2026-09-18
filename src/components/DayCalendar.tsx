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
import type { TaskRecord } from '../models/types';
import { HOLD_DELAY, useDragDrop } from './drag/DragDropContext';

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
  pixelsPerHour?: number;
  onOpenTask: (id: string) => void;
  onCreateAt: (iso: string, time: string, name: string) => void;
};

export function DayCalendar({
  todayISO,
  tasksForDay,
  pixelsPerHour = PX_PER_HOUR,
  onOpenTask,
  onCreateAt,
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
  const expanding = useRef(false);
  const todayIndex = past;
  const focusY = calendarScrollOffset(
    tasksForDay(todayISO).map((task) => task.startTime),
    CAL_START_HOUR,
    pixelsPerHour,
  );
  const centered = useRef(false);
  const { refreshZones } = useDragDrop();

  useLayoutEffect(() => {
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
      <ScrollView
        ref={hourScrollRef}
        style={styles.gridScroll}
        contentOffset={{ x: 0, y: focusY }}
        onScroll={() => refreshZones()}
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
          <ScrollView
            ref={dayScrollRef}
            horizontal
            nestedScrollEnabled
            showsHorizontalScrollIndicator={false}
            onScroll={(event) => {
              const x = event.nativeEvent.contentOffset.x;
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
              />
            ))}
          </ScrollView>
        </View>
      </ScrollView>
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
            pixelsPerHour={pixelsPerHour}
            onOpenTask={onOpenTask}
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
  pixelsPerHour,
  onOpenTask,
}: {
  task: TaskRecord;
  pixelsPerHour: number;
  onOpenTask: (id: string) => void;
}) {
  const { registerZone, bestId, armDrag, activateDrag, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const nestId = `nest-cal-${task.id}`;
  const minutes = parseMinutes(task.startTime);
  const top = (minutes / 60) * pixelsPerHour;
  const height = Math.max(28, (task.duration / 60) * pixelsPerHour);
  const highlighted = bestId === nestId;

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
    <Pressable
      ref={ref}
      collapsable={false}
      testID={`cal-block-${task.id}`}
      onLayout={() => refreshZones()}
      onPress={() => onOpenTask(task.id)}
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
      style={[styles.block, { top, height }, highlighted && styles.blockHot]}
    >
      {task.imageDownloadURL ? <Image source={{ uri: task.imageDownloadURL }} style={styles.blockPhoto} /> : null}
      <Text style={styles.blockTime}>{task.startTime}</Text>
      <Text style={styles.blockName} numberOfLines={2}>
        {task.name}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
  block: {
    position: 'absolute',
    left: 4,
    right: 4,
    backgroundColor: 'rgba(255,255,255,0.72)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    overflow: 'hidden',
    zIndex: 2,
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
