import { Image, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { colors, type } from '../theme';
import {
  calendarJumpToNowY,
  calendarMountedWindow,
  calendarNudgeCreateTime,
  calendarShouldRecenter,
  calendarStripIndex,
  calendarStripISO,
  CAL_ORIGIN_OFFSET,
  CAL_TOTAL_COLUMNS,
  dayNumber,
  formatMinutes,
  habitDueOn,
  nowHM,
  parseMinutes,
  snapMinutes,
  weekdayShort,
} from '../dates';
import type { TaskRecord, TaskTree } from '../models/types';
import { HABIT_TEMPLATES } from '../services/seed';
import { createComposerLock } from './composerLock';
import { HOLD_DELAY, useDragDrop, type Rect } from './drag/DragDropContext';
import { durationFromPointerDelta, measureNode, readWindowRect, snapDuration } from './drag/geometry';

export const CAL_START_HOUR = 0;
export const CAL_END_HOUR = 24;
export const PX_PER_HOUR = 50;
export const CAL_PX_PER_HOUR = PX_PER_HOUR;
const TIME_AXIS = 22;
const HOURS = Array.from({ length: CAL_END_HOUR - CAL_START_HOUR }, (_, i) => CAL_START_HOUR + i);

type CalComposer = { iso: string; time: string } | null;

type Props = {
  todayISO: string;
  tasksForDay: (iso: string) => TaskRecord[];
  childrenOf: (id: string) => TaskTree[];
  pixelsPerHour?: number;
  columnWidthHint?: number;
  snapInterval?: number;
  defaultDuration?: number;
  onOpenTask: (id: string) => void;
  onCreateAt: (iso: string, time: string, name: string) => void;
  onSetDuration: (id: string, minutes: number) => void;
  parentLabel: (id: string) => string;
};

export function DayCalendar({
  todayISO,
  tasksForDay,
  childrenOf,
  pixelsPerHour = PX_PER_HOUR,
  columnWidthHint = 160,
  snapInterval = 1,
  defaultDuration = 30,
  onOpenTask,
  onCreateAt,
  onSetDuration,
  parentLabel,
}: Props) {
  const todayIndex = CAL_ORIGIN_OFFSET;
  const initialWindow = calendarMountedWindow(todayIndex, todayIndex + 1);
  const [windowStart, setWindowStart] = useState(initialWindow.start);
  const [windowEnd, setWindowEnd] = useState(initialWindow.end);
  const [columnWidth, setColumnWidth] = useState(0);
  const [composer, setComposer] = useState<CalComposer>(null);
  const [draft, setDraft] = useState('');
  const [centerISO, setCenterISO] = useState(todayISO);
  const days = useMemo(() => {
    const list: string[] = [];
    for (let i = windowStart; i <= windowEnd; i += 1) list.push(calendarStripISO(todayISO, i));
    return list;
  }, [todayISO, windowStart, windowEnd]);
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
  const focusY = calendarJumpToNowY(nowHM(), pixelsPerHour);
  const centered = useRef(false);
  const hoursPinned = useRef(false);
  const pairingScroll = useRef(false);
  const drivingScroll = useRef<'header' | 'days' | null>(null);
  const { refreshZones, registerScroller, drag, pointerLocked } = useDragDrop();
  const leftSpacer = windowStart * columnWidth;
  const rightSpacer = Math.max(0, CAL_TOTAL_COLUMNS - 1 - windowEnd) * columnWidth;

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
        pairingScroll.current = true;
        dayScrollRef.current?.scrollTo({ x: next.x, animated: false });
        headerScrollRef.current?.scrollTo({ x: next.x, animated: false });
        requestAnimationFrame(() => {
          pairingScroll.current = false;
        });
      },
    });
    return () => {
      unHour();
      unDays();
    };
  }, [registerScroller]);

  function measureScroller(ref: { current: View | null }, into: { current: Rect | null }) {
    measureNode(ref.current, (rect) => {
      into.current = rect;
    });
  }

  useLayoutEffect(() => {
    if (!hoursPinned.current) {
      hourOffset.current = { x: 0, y: focusY };
      hourScrollRef.current?.scrollTo({ y: focusY, animated: false });
      hoursPinned.current = true;
    }
    if (columnWidth < 40) return;
    if (centered.current) return;
    const x = todayIndex * columnWidth;
    dayOffset.current = { x, y: 0 };
    pairingScroll.current = true;
    dayScrollRef.current?.scrollTo({ x, animated: false });
    headerScrollRef.current?.scrollTo({ x, animated: false });
    requestAnimationFrame(() => {
      pairingScroll.current = false;
    });
    centered.current = true;
  }, [columnWidth, focusY, todayIndex]);

  function beginLinkedScroll(from: 'header' | 'days') {
    drivingScroll.current = from;
  }

  function endLinkedScroll(from: 'header' | 'days') {
    if (drivingScroll.current === from) drivingScroll.current = null;
  }

  function pairLinkedScroll(from: 'header' | 'days', x: number) {
    dayOffset.current = { x, y: 0 };
    if (pairingScroll.current) {
      syncDayScroll(x);
      refreshZones();
      return;
    }
    if (drivingScroll.current && drivingScroll.current !== from) return;
    pairingScroll.current = true;
    if (from === 'header') dayScrollRef.current?.scrollTo({ x, animated: false });
    else headerScrollRef.current?.scrollTo({ x, animated: false });
    requestAnimationFrame(() => {
      pairingScroll.current = false;
    });
    syncDayScroll(x);
    refreshZones();
  }

  function syncDayScroll(x: number) {
    const width = Math.max(columnWidth, 1);
    const viewW = dayViewport.current?.width || width;
    const left = Math.max(0, Math.min(CAL_TOTAL_COLUMNS - 1, Math.floor(x / width)));
    const right = Math.max(left, Math.min(CAL_TOTAL_COLUMNS - 1, Math.ceil((x + viewW) / width) - 1));
    const iso = calendarStripISO(todayISO, left);
    if (iso !== centerISO) setCenterISO(iso);
    if (calendarShouldRecenter(left, right, windowStart, windowEnd)) {
      let next = calendarMountedWindow(left, right);
      if (composer) {
        const idx = calendarStripIndex(todayISO, composer.iso);
        if (idx >= 0 && idx < CAL_TOTAL_COLUMNS) {
          next = { start: Math.min(next.start, idx), end: Math.max(next.end, idx) };
        }
      }
      if (next.start !== windowStart || next.end !== windowEnd) {
        setWindowStart(next.start);
        setWindowEnd(next.end);
      }
    }
  }

  function onCreateKeepOpen(iso: string, time: string, name: string, keepOpen: boolean) {
    onCreateAt(iso, time, name);
    setDraft('');
    if (!keepOpen) {
      setComposer(null);
      return;
    }
    setComposer({ iso, time: time ? calendarNudgeCreateTime(time, defaultDuration) : '' });
  }

  function headerIcons(iso: string) {
    const allDay = tasksForDay(iso).filter((task) => !task.startTime);
    const chips = allDay.filter((task) => !task.iconURL);
    const icons = [
      ...allDay.filter((task) => task.iconURL).map((task) => ({ id: task.id, name: task.name, iconURL: task.iconURL })),
      ...HABIT_TEMPLATES.filter(
        (habit) => habitDueOn(iso, habit.rr) && !allDay.some((task) => task.name === habit.name || task.iconURL === habit.iconURL),
      ).map((habit) => ({ id: `${habit.id}-${iso}`, name: habit.name, iconURL: habit.iconURL })),
    ];
    return { chips, icons };
  }

  return (
    <View
      style={styles.wrap}
      testID="day-calendar"
      onLayout={(event) => {
        const available = Math.max(columnWidthHint, event.nativeEvent.layout.width - TIME_AXIS);
        const next = Math.min(columnWidthHint, Math.round(available * 0.72));
        if (Math.abs(next - columnWidth) > 8) setColumnWidth(next);
      }}
    >
      <View style={styles.headerRow}>
        <Text style={[styles.month, { width: TIME_AXIS }]} testID="calendar-month">
          {Number(centerISO.slice(5, 7))}
        </Text>
        <ScrollView
          ref={headerScrollRef}
          horizontal
          scrollEnabled={!drag && !pointerLocked}
          showsHorizontalScrollIndicator={false}
          style={styles.headerScroll}
          onScrollBeginDrag={() => beginLinkedScroll('header')}
          onScrollEndDrag={(event) => {
            const vx = event.nativeEvent.velocity?.x ?? 0;
            if (Math.abs(vx) < 0.02) endLinkedScroll('header');
          }}
          onMomentumScrollEnd={() => endLinkedScroll('header')}
          onScroll={(event) => {
            pairLinkedScroll('header', event.nativeEvent.contentOffset.x);
          }}
          scrollEventThrottle={16}
        >
          <View style={{ width: leftSpacer }} />
          {days.map((iso) => {
            const { chips, icons } = headerIcons(iso);
            return (
              <DayHead
                key={`h-${iso}`}
                iso={iso}
                width={columnWidth}
                isToday={iso === todayISO}
                chips={chips}
                icons={icons}
                onOpenTask={onOpenTask}
                composing={composer?.iso === iso && composer.time === ''}
                draft={draft}
                onDraft={setDraft}
                onCompose={() => {
                  if (composer?.iso === iso && composer.time === '') return;
                  setDraft('');
                  setComposer({ iso, time: '' });
                }}
                onCreate={(name, keepOpen) => onCreateKeepOpen(iso, '', name, keepOpen)}
                onCancel={() => setComposer(null)}
              />
            );
          })}
          <View style={{ width: rightSpacer }} />
        </ScrollView>
      </View>
      <View
        ref={hourWrapRef}
        style={styles.gridScroll}
        onLayout={() => measureScroller(hourWrapRef, hourViewport)}
      >
      <ScrollView
        ref={hourScrollRef}
        style={styles.fill}
        scrollEnabled={!drag && !pointerLocked}
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
                {hour === 0 ? '' : String(hour).padStart(2, '0')}
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
            scrollEnabled={!drag && !pointerLocked}
            showsHorizontalScrollIndicator={false}
            onScrollBeginDrag={() => beginLinkedScroll('days')}
            onScrollEndDrag={(event) => {
              const vx = event.nativeEvent.velocity?.x ?? 0;
              if (Math.abs(vx) < 0.02) endLinkedScroll('days');
            }}
            onMomentumScrollEnd={() => endLinkedScroll('days')}
            onScroll={(event) => {
              pairLinkedScroll('days', event.nativeEvent.contentOffset.x);
            }}
            scrollEventThrottle={16}
            testID="calendar-days"
          >
            <View style={{ width: leftSpacer }} />
            {days.map((iso) => (
              <DayColumn
                key={iso}
                iso={iso}
                isToday={iso === todayISO}
                width={columnWidth}
                height={gridHeight}
                pixelsPerHour={pixelsPerHour}
                snapInterval={snapInterval}
                tasks={tasksForDay(iso)}
                composer={composer?.iso === iso && composer.time !== '' ? composer : null}
                draft={draft}
                onDraft={setDraft}
                onCompose={setComposer}
                onCreate={(time, name, keepOpen) => onCreateKeepOpen(iso, time, name, keepOpen)}
                onOpenTask={onOpenTask}
                childrenOf={childrenOf}
                onSetDuration={onSetDuration}
                parentLabel={parentLabel}
              />
            ))}
            <View style={{ width: rightSpacer }} />
          </ScrollView>
          </View>
        </View>
      </ScrollView>
      </View>
    </View>
  );
}

function DayHead({
  iso,
  width,
  isToday,
  chips,
  icons,
  onOpenTask,
  composing,
  draft,
  onDraft,
  onCompose,
  onCreate,
  onCancel,
}: {
  iso: string;
  width: number;
  isToday: boolean;
  chips: TaskRecord[];
  icons: { id: string; name: string; iconURL: string }[];
  onOpenTask: (id: string) => void;
  composing: boolean;
  draft: string;
  onDraft: (value: string) => void;
  onCompose: () => void;
  onCreate: (name: string, keepOpen: boolean) => void;
  onCancel: () => void;
}) {
  const { registerZone, bestId, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const lock = useRef(createComposerLock()).current;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const composingRef = useRef(composing);
  composingRef.current = composing;
  const wasComposing = useRef(composing);
  const alive = useRef(true);
  const zoneId = `cal-head-${iso}`;
  const highlighted = bestId === zoneId;

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      lock.dispose();
    };
  }, [lock]);

  useEffect(() => {
    return registerZone({
      id: zoneId,
      target: { kind: 'cal', iso, allDay: true },
      ref,
    });
  }, [iso, registerZone, zoneId]);

  useEffect(() => {
    if (composing && !wasComposing.current) lock.beginCompose();
    wasComposing.current = composing;
  }, [composing, lock]);

  function commit(keepOpen: boolean) {
    if (!alive.current) return;
    if (!lock.commit()) return;
    const name = draftRef.current.trim();
    if (name) onCreate(name, keepOpen);
    else if (composingRef.current) onCancel();
  }

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      nativeID={zoneId}
      testID={`day-head-${iso}`}
      onLayout={() => refreshZones()}
      onPress={() => {
        if (composing) return;
        onCompose();
      }}
      style={[styles.dayHead, { width }, highlighted && styles.columnHot]}
    >
      <Text style={[styles.dow, isToday && styles.dowToday]}>
        {`${weekdayShort(iso)} ${dayNumber(iso)}`}
      </Text>
      {icons.length ? (
        <View style={styles.iconRow} pointerEvents="none">
          {icons.map((icon) => (
            <Image
              key={icon.id}
              testID={`cal-icon-${icon.id}`}
              accessibilityLabel={icon.name}
              source={{ uri: icon.iconURL }}
              style={styles.habitIcon}
            />
          ))}
        </View>
      ) : null}
      <View style={styles.chipRow}>
        {chips.map((task) => (
          <Pressable
            key={task.id}
            testID={`cal-chip-${task.id}`}
            onPress={() => onOpenTask(task.id)}
            style={styles.allDayChip}
          >
            <Text numberOfLines={1} style={styles.chipText}>
              {task.name}
            </Text>
          </Pressable>
        ))}
      </View>
      {composing ? (
        <Pressable onPress={(event) => event.stopPropagation()} style={styles.headComposer}>
          <TextInput
            autoFocus
            blurOnSubmit={false}
            value={draft}
            onChangeText={onDraft}
            placeholder="All-day"
            placeholderTextColor={colors.faint}
            style={styles.headInput}
            testID={`cal-head-input-${iso}`}
            onSubmitEditing={() => commit(true)}
            onBlur={() =>
              lock.scheduleBlur(() => {
                if (!alive.current) return;
                commit(false);
              })
            }
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function DayColumn({
  iso,
  isToday,
  width,
  height,
  pixelsPerHour,
  snapInterval,
  tasks,
  composer,
  draft,
  onDraft,
  onCompose,
  onCreate,
  onOpenTask,
  childrenOf,
  onSetDuration,
  parentLabel,
}: {
  iso: string;
  isToday: boolean;
  width: number;
  height: number;
  pixelsPerHour: number;
  snapInterval: number;
  tasks: TaskRecord[];
  composer: CalComposer;
  draft: string;
  onDraft: (value: string) => void;
  onCompose: (slot: CalComposer) => void;
  onCreate: (time: string, name: string, keepOpen: boolean) => void;
  onOpenTask: (id: string) => void;
  childrenOf: (id: string) => TaskTree[];
  onSetDuration: (id: string, minutes: number) => void;
  parentLabel: (id: string) => string;
}) {
  const { registerZone, bestId, refreshZones, drag } = useDragDrop();
  const ref = useRef<View>(null);
  const colY = useRef(0);
  const lock = useRef(createComposerLock()).current;
  const inputRef = useRef<TextInput>(null);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const composerRef = useRef(composer);
  composerRef.current = composer;
  const composingRef = useRef(!!composer);
  composingRef.current = !!composer;
  const wasComposing = useRef(!!composer);
  const alive = useRef(true);
  const zoneId = `cal-${iso}`;
  const highlighted = bestId === zoneId;
  const liveColY = readWindowRect(ref.current, zoneId)?.y ?? colY.current;
  const interval = Math.max(1, snapInterval);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      lock.dispose();
    };
  }, [lock]);

  useEffect(() => {
    return registerZone({
      id: zoneId,
      target: { kind: 'cal', iso },
      ref,
    });
  }, [iso, registerZone, zoneId]);

  useEffect(() => {
    if (composer && !wasComposing.current) lock.beginCompose();
    wasComposing.current = !!composer;
  }, [composer, lock]);

  useEffect(() => {
    if (!highlighted || !drag) return;
    measureNode(
      ref.current,
      (rect) => {
        colY.current = rect.y;
      },
      zoneId,
    );
  }, [drag, highlighted, zoneId]);

  function timeAt(pageY: number, columnY: number) {
    const minutes = ((pageY - columnY) / pixelsPerHour) * 60;
    return formatMinutes(snapMinutes(minutes, interval));
  }

  function commit(keepOpen: boolean) {
    if (!alive.current) return;
    if (!lock.commit()) return;
    const name = draftRef.current.trim();
    const slot = composerRef.current;
    if (name && slot) onCreate(slot.time, name, keepOpen);
    else if (composingRef.current) onCompose(null);
  }

  function openAt(pageY: number, columnY: number) {
    const time = timeAt(pageY, columnY);
    const current = composerRef.current;
    if (current) {
      lock.skipNextBlur();
      if (current.time !== time) onCompose({ iso, time });
      requestAnimationFrame(() => inputRef.current?.focus());
      return;
    }
    onDraft('');
    onCompose({ iso, time });
  }

  return (
    <Pressable
      ref={ref}
      collapsable={false}
      nativeID={zoneId}
      testID={`day-column-${iso}`}
      onLayout={() => {
        refreshZones();
        measureNode(
          ref.current,
          (rect) => {
            colY.current = rect.y;
          },
          zoneId,
        );
      }}
      onPressIn={() => {
        if (composerRef.current) lock.skipNextBlur();
      }}
      onPress={(event) => {
        const pageY = event.nativeEvent.pageY;
        measureNode(ref.current, (rect) => {
          openAt(pageY, rect.y);
        });
      }}
      style={[styles.column, { width, height }]}
    >
      {HOURS.map((hour) => (
        <View key={hour} style={[styles.hourLine, { top: hour * pixelsPerHour }]} />
      ))}
      {isToday ? (
        <View
          pointerEvents="none"
          testID="now-line"
          style={[styles.nowLine, { top: (parseMinutes(nowHM()) / 60) * pixelsPerHour }]}
        >
          <Text style={styles.nowLabel}>{nowHM()}</Text>
        </View>
      ) : null}
      {highlighted && drag ? (
        <View
          pointerEvents="none"
          testID={`cal-preview-${iso}`}
          style={[
            styles.calPreview,
            {
              top: (snapMinutes(((drag.y - liveColY) / pixelsPerHour) * 60, interval) / 60) * pixelsPerHour,
              height: Math.max(28, drag.height),
            },
          ]}
        />
      ) : null}
      {tasks
        .filter((task) => task.startTime)
        .map((task) => (
          <CalBlock
            key={task.id}
            task={task}
            children={childrenOf(task.id)}
            parentLabel={parentLabel(task.id)}
            pixelsPerHour={pixelsPerHour}
            onOpenTask={onOpenTask}
            onSetDuration={onSetDuration}
          />
        ))}
      {composer ? (
        <Pressable
          onPress={(event) => event.stopPropagation()}
          style={[
            styles.calComposer,
            { top: (parseMinutes(composer.time) / 60) * pixelsPerHour },
          ]}
        >
          <TextInput
            ref={inputRef}
            autoFocus
            blurOnSubmit={false}
            value={draft}
            onChangeText={onDraft}
            placeholder={composer.time}
            placeholderTextColor={colors.faint}
            style={styles.calInput}
            testID={`cal-input-${iso}`}
            onSubmitEditing={() => commit(true)}
            onBlur={() =>
              lock.scheduleBlur(() => {
                if (!alive.current) return;
                commit(false);
              })
            }
          />
        </Pressable>
      ) : null}
    </Pressable>
  );
}

function CalBlock({
  task,
  children,
  parentLabel,
  pixelsPerHour,
  onOpenTask,
  onSetDuration,
}: {
  task: TaskRecord;
  children: TaskTree[];
  parentLabel: string;
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
      target: { kind: 'nest', parentID: task.id, at: 'last' },
      ref,
      ownerTaskId: task.id,
    });
  }, [nestId, registerZone, task.id]);

  function startPointerDrag(pageX: number, pageY: number, activate = false) {
    const token = activate ? activateDrag() : undefined;
    measureNode(
      ref.current,
      (rect) => {
        armDrag(task, task.parentID ? 'nested-cal' : 'cal', pageX, pageY, rect, token);
        if (activate && token != null) activateDrag(token);
      },
      `cal-block-${task.id}`,
    );
  }

  return (
    <View style={[styles.blockWrap, { top, height }]} pointerEvents="box-none">
      <Pressable
        ref={ref}
        collapsable={false}
        nativeID={nestId}
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
          startPointerDrag(event.nativeEvent.pageX, event.nativeEvent.pageY, true);
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
        <View style={styles.blockTitleRow}>
          <Text style={styles.blockName} numberOfLines={2}>
            {task.name}
          </Text>
          {parentLabel ? <Text style={styles.parentBadge}>{parentLabel}</Text> : null}
        </View>
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
          preventDefault?: () => void;
          currentTarget?: { setPointerCapture?: (id: number) => void };
          pointerId?: number;
          nativeEvent?: { pageY?: number; pointerId?: number };
          clientY?: number;
        }) => {
          event.stopPropagation?.();
          event.preventDefault?.();
          const pointerId = event.pointerId ?? event.nativeEvent?.pointerId;
          if (pointerId != null) event.currentTarget?.setPointerCapture?.(pointerId);
          begin(event.nativeEvent?.pageY ?? event.clientY ?? 0);
        },
        onPointerMove: (event: { nativeEvent?: { pageY?: number }; clientY?: number }) => {
          move(event.nativeEvent?.pageY ?? event.clientY ?? 0);
        },
        onPointerUp: (event: { stopPropagation?: () => void }) => {
          event.stopPropagation?.();
          finish();
        },
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  month: {
    paddingTop: 8,
    paddingBottom: 2,
    color: colors.ink,
    fontSize: type.small,
    fontWeight: '600',
    textAlign: 'center',
  },
  headerScroll: {
    flex: 1,
    maxHeight: 88,
  },
  dayHead: {
    minHeight: 36,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 8,
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingRight: 6,
    paddingTop: 2,
  },
  iconRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
    paddingLeft: 6,
    paddingTop: 2,
  },
  habitIcon: {
    width: 32,
    height: 32,
  },
  nowLine: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 2,
    backgroundColor: colors.danger,
    zIndex: 3,
  },
  nowLabel: {
    position: 'absolute',
    left: 4,
    top: -12,
    color: colors.danger,
    fontSize: 10,
    fontWeight: '700',
  },
  allDayChip: {
    backgroundColor: colors.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 6,
    paddingVertical: 2,
    maxWidth: 120,
  },
  chipText: {
    color: colors.ink,
    fontSize: 11,
  },
  calPreview: {
    position: 'absolute',
    left: 4,
    right: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
    backgroundColor: colors.dropPreview,
    zIndex: 1,
  },
  blockTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  parentBadge: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '600',
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
  headComposer: {
    marginTop: 4,
    marginRight: 6,
    height: 28,
    borderWidth: 2,
    borderColor: colors.composer,
    borderRadius: 6,
    backgroundColor: colors.card,
  },
  headInput: {
    flex: 1,
    paddingHorizontal: 6,
    color: colors.ink,
    fontSize: type.small,
  },
});
