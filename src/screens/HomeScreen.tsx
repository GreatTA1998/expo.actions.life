import { useCallback, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { Inbox } from '../components/Inbox';
import { DayCalendar } from '../components/DayCalendar';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { SplitPane } from '../components/SplitPane';
import { DragDropProvider, type DragOrigin, type DropTarget, type Rect } from '../components/drag/DragDropContext';
import { formatMinutes, parseMinutes, todayISO } from '../dates';
import type { TaskRecord } from '../models/types';
import type { TaskTreeStore } from '../services/taskStore';

type Props = {
  store: TaskTreeStore;
  onOpen: (id: string) => void;
  onMenu: (task: TaskRecord) => void;
};

export function HomeScreen({ store, onOpen, onMenu }: Props) {
  const [revealTopToken, setRevealTopToken] = useState(0);
  const today = todayISO();
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskRecord[]>();
    for (const task of store.allTasks()) {
      if (!task.startDateISO || task.isTombstone) continue;
      const list = map.get(task.startDateISO) ?? [];
      list.push(task);
      map.set(task.startDateISO, list);
    }
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime || '99:99').localeCompare(b.startTime || '99:99'));
    }
    return map;
  }, [store, store.inbox, store.allTasks()]);

  const tasksForDay = useCallback(
    (iso: string) => tasksByDay.get(iso) ?? [],
    [tasksByDay],
  );

  const onDrop = useCallback(
    (
      taskId: string,
      origin: DragOrigin,
      target: DropTarget,
      pointer: { x: number; y: number },
      zoneRect: Rect | null,
    ) => {
      if (target.kind === 'list') {
        void store.placeOnList(taskId, {
          parentID: target.parentID,
          index: target.index,
          unschedule: origin !== 'list',
        });
        return;
      }
      if (target.kind === 'nest') {
        void store.placeOnList(taskId, {
          parentID: target.parentID,
          index: 0,
          unschedule: origin !== 'list',
        });
        return;
      }
      const px = store.profile.pixelsPerHour || 50;
      const minutes = zoneRect
        ? Math.max(0, ((pointer.y - zoneRect.y) / px) * 60)
        : parseMinutes('09:00');
      const time = formatMinutes(Math.round(minutes / 15) * 15);
      void store.placeOnCal(taskId, target.iso, time, origin === 'nested-cal');
    },
    [store],
  );

  return (
    <KeyboardAvoidingView
      style={styles.fill}
      behavior={Platform.OS === 'ios' ? 'padding' : Platform.OS === 'android' ? 'height' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
    >
      <DragDropProvider onDrop={onDrop}>
        <SplitPane
          split={store.listHeightSplit}
          onChange={(value) => {
            void store.setListHeightSplit(value);
          }}
          top={
            <ErrorBoundary label="Calendar">
              <DayCalendar
                todayISO={today}
                tasksForDay={tasksForDay}
                childrenOf={(id) => store.childrenOf(id)}
                pixelsPerHour={store.profile.pixelsPerHour || 50}
                onOpenTask={onOpen}
                onCreateAt={(iso, time, name) => {
                  void store.create({
                    name,
                    onList: false,
                    startDateISO: iso,
                    startTime: time,
                  });
                }}
                onSetDuration={(id, minutes) => {
                  void store.setDuration(id, minutes);
                }}
              />
            </ErrorBoundary>
          }
          bottom={
            <Inbox
              forest={store.inbox}
              onToggleDone={(id) => void store.toggleDone(id)}
              onToggleCollapsed={(id) => {
                const task = store.task(id);
                if (task) void store.setCollapsed(id, !task.isCollapsed);
              }}
              onOpen={onOpen}
              onMenu={onMenu}
              onCreate={(slot, name) => {
                void store
                  .create({
                    name,
                    parentID: slot.parentID || undefined,
                    onList: true,
                    index: slot.index,
                  })
                  .then(() => {
                    if (!slot.parentID) setRevealTopToken((value) => value + 1);
                  });
              }}
              revealTopToken={revealTopToken}
            />
          }
        />
      </DragDropProvider>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
