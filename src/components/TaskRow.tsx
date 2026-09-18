import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { colors, type } from '../theme';
import type { TaskRecord, TaskTree } from '../models/types';
import { HOLD_DELAY, useDragDrop } from './drag/DragDropContext';
import { Dropzone } from './Dropzone';

export type ComposerSlot = { parentID: string; index: number } | null;

type Props = {
  node: TaskTree;
  depth: number;
  composer: ComposerSlot;
  onCompose: (slot: ComposerSlot) => void;
  onCreate: (slot: { parentID: string; index: number }, name: string) => void;
  onToggleDone: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (task: TaskRecord) => void;
};

export function TaskRow({
  node,
  depth,
  composer,
  onCompose,
  onCreate,
  onToggleDone,
  onToggleCollapsed,
  onOpen,
  onMenu,
}: Props) {
  const { task, children } = node;
  const { registerZone, bestId, armDrag, activateDrag, refreshZones } = useDragDrop();
  const rowRef = useRef<View>(null);
  const hasChildren = children.length > 0;
  const dateBadge = task.startDateISO ? task.startDateISO.slice(5) : '';
  const nestId = `nest-${task.id}`;
  const highlighted = bestId === nestId;

  useEffect(() => {
    return registerZone({
      id: nestId,
      target: { kind: 'nest', parentID: task.id },
      ref: rowRef,
      ownerTaskId: task.id,
    });
  }, [nestId, registerZone, task.id]);

  function startPointerDrag(pageX: number, pageY: number) {
    const nodeView = rowRef.current as (View & { measureInWindow?: Function }) | null;
    nodeView?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
      armDrag(task, 'list', pageX, pageY, { x, y, width, height });
    });
  }

  return (
    <View>
      <View
        ref={rowRef}
        collapsable={false}
        testID={`task-row-${task.id}`}
        onLayout={() => refreshZones()}
        style={[styles.row, { paddingLeft: 12 + depth * 18 }, highlighted && styles.nestHot]}
      >
        {hasChildren ? (
          <Pressable onPress={() => onToggleCollapsed(task.id)} hitSlop={8} style={styles.chevronHit}>
            <Text style={styles.chevron}>{task.isCollapsed ? '▸' : '▾'}</Text>
          </Pressable>
        ) : (
          <View style={styles.chevronHit} />
        )}
        <Pressable
          onPress={() => onToggleDone(task.id)}
          style={[styles.box, task.isDone && styles.boxDone]}
          hitSlop={6}
          testID={`task-done-${task.id}`}
        >
          {task.isDone ? <Text style={styles.check}>✓</Text> : null}
        </Pressable>
        <Pressable
          onPress={() => onOpen(task.id)}
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
          style={styles.body}
          testID={`task-open-${task.id}`}
        >
          <View style={styles.bodyText}>
            <View style={styles.nameRow}>
              <Text style={[styles.name, task.isDone && styles.nameDone]} numberOfLines={2}>
                {task.name || 'Untitled'}
              </Text>
              {dateBadge ? <Text style={styles.badge}>{dateBadge}</Text> : null}
            </View>
            {task.notes ? (
              <Text style={styles.notes} numberOfLines={2}>
                {task.notes}
              </Text>
            ) : null}
          </View>
        </Pressable>
        <Pressable onPress={() => onMenu(task)} hitSlop={8} style={styles.menuHit} testID={`task-menu-${task.id}`}>
          <Text style={styles.menu}>⋯</Text>
        </Pressable>
      </View>
      {!task.isCollapsed ? (
        <View>
          {children.map((child, i) => (
            <View key={child.task.id}>
              <Dropzone
                zoneId={`list-${task.id}-${i}`}
                parentID={task.id}
                index={i}
                depth={depth + 1}
                composing={composer?.parentID === task.id && composer.index === i}
                onCompose={() => onCompose({ parentID: task.id, index: i })}
                onSubmit={(name) => onCreate({ parentID: task.id, index: i }, name)}
                onCancel={() => onCompose(null)}
              />
              <TaskRow
                node={child}
                depth={depth + 1}
                composer={composer}
                onCompose={onCompose}
                onCreate={onCreate}
                onToggleDone={onToggleDone}
                onToggleCollapsed={onToggleCollapsed}
                onOpen={onOpen}
                onMenu={onMenu}
              />
            </View>
          ))}
          <Dropzone
            zoneId={`list-${task.id}-${children.length}`}
            parentID={task.id}
            index={children.length}
            depth={depth + 1}
            composing={composer?.parentID === task.id && composer.index === children.length}
            onCompose={() => onCompose({ parentID: task.id, index: children.length })}
            onSubmit={(name) => onCreate({ parentID: task.id, index: children.length }, name)}
            onCancel={() => onCompose(null)}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    paddingRight: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  nestHot: {
    backgroundColor: colors.dropPreview,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
  },
  chevronHit: {
    width: 22,
    alignItems: 'center',
  },
  chevron: {
    color: colors.muted,
    fontSize: 14,
  },
  box: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: colors.ink,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 10,
    backgroundColor: colors.card,
  },
  boxDone: {
    backgroundColor: colors.ink,
  },
  check: {
    color: colors.card,
    fontSize: 12,
    fontWeight: '700',
    lineHeight: 14,
  },
  body: {
    flex: 1,
    justifyContent: 'center',
  },
  bodyText: {
    flex: 1,
    paddingVertical: 2,
  },
  nameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  name: {
    flex: 1,
    color: colors.ink,
    fontSize: type.body,
  },
  nameDone: {
    color: colors.done,
    textDecorationLine: 'line-through',
  },
  notes: {
    marginTop: 2,
    color: colors.muted,
    fontSize: type.small,
    lineHeight: 16,
  },
  badge: {
    color: colors.muted,
    fontSize: type.micro,
    letterSpacing: 0.3,
  },
  menuHit: {
    width: 28,
    alignItems: 'center',
  },
  menu: {
    color: colors.muted,
    fontSize: 18,
    lineHeight: 20,
  },
});
