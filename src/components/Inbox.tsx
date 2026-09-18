import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../theme';
import type { TaskRecord, TaskTree } from '../models/types';
import { Dropzone } from './Dropzone';
import { useDragDrop, type Rect } from './drag/DragDropContext';
import { measureNode } from './drag/geometry';
import { TaskRow, type ComposerSlot } from './TaskRow';

type Props = {
  forest: TaskTree[];
  onToggleDone: (id: string) => void;
  onToggleCollapsed: (id: string) => void;
  onOpen: (id: string) => void;
  onMenu: (task: TaskRecord) => void;
  onCreate: (slot: { parentID: string; index: number }, name: string, extras?: { duration?: number }) => void;
};

export function Inbox({
  forest,
  onToggleDone,
  onToggleCollapsed,
  onOpen,
  onMenu,
  onCreate,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const wrapRef = useRef<View>(null);
  const offset = useRef({ x: 0, y: 0 });
  const viewport = useRef<Rect | null>(null);
  const [composer, setComposer] = useState<ComposerSlot>(null);
  const { registerScroller, refreshZones, drag, pointerLocked } = useDragDrop();

  useEffect(() => {
    return registerScroller({
      id: 'inbox',
      axis: 'y',
      getViewport: () => viewport.current,
      getOffset: () => offset.current,
      scrollTo: (next) => {
        offset.current = next;
        scrollRef.current?.scrollTo({ y: next.y, animated: false });
      },
      setEnabled: (enabled) => {
        scrollRef.current?.setNativeProps({ scrollEnabled: enabled });
      },
    });
  }, [registerScroller]);

  function measureViewport() {
    measureNode(wrapRef.current, (rect) => {
      viewport.current = rect;
    });
  }

  return (
    <View ref={wrapRef} style={styles.wrap} testID="inbox" onLayout={measureViewport}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        scrollEnabled={!drag && !pointerLocked}
        canCancelContentTouches={!pointerLocked}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        onScroll={(event) => {
          offset.current = { x: 0, y: event.nativeEvent.contentOffset.y };
          refreshZones();
        }}
        scrollEventThrottle={16}
      >
        {forest.map((node, i) => (
          <View key={node.task.id}>
            <Dropzone
              key={`list-root-${node.task.id}-before`}
              zoneId={`list-root-${i}`}
              parentID=""
              index={i}
              depth={0}
              composing={composer?.parentID === '' && composer.index === i}
              onCompose={() => setComposer({ parentID: '', index: i })}
              onSubmit={(name, extras) => {
                onCreate({ parentID: '', index: i }, name, extras);
                setComposer({ parentID: '', index: i + 1 });
              }}
              onCancel={() => setComposer(null)}
            />
            <TaskRow
              node={node}
              depth={0}
              composer={composer}
              onCompose={setComposer}
              onCreate={(slot, name, extras) => {
                onCreate(slot, name, extras);
                setComposer({ parentID: slot.parentID, index: slot.index + 1 });
              }}
              onToggleDone={onToggleDone}
              onToggleCollapsed={onToggleCollapsed}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          </View>
        ))}
        <Dropzone
          key={`list-root-end-${forest.length}`}
          zoneId={`list-root-${forest.length}`}
          parentID=""
          index={forest.length}
          depth={0}
          composing={composer?.parentID === '' && composer.index === forest.length}
          onCompose={() => setComposer({ parentID: '', index: forest.length })}
          onSubmit={(name, extras) => {
            const at = forest.length;
            onCreate({ parentID: '', index: at }, name, extras);
            setComposer({ parentID: '', index: at + 1 });
          }}
          onCancel={() => setComposer(null)}
        />
        <Pressable
          testID="inbox-empty-padding"
          onPress={() => setComposer({ parentID: '', index: forest.length })}
          style={styles.emptyHit}
        >
          {forest.length === 0 && !composer ? (
            <Text style={styles.empty}>Tap the empty space to add a task</Text>
          ) : null}
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.listBg,
  },
  content: {
    paddingBottom: 48,
    flexGrow: 1,
  },
  emptyHit: {
    flexGrow: 1,
    minHeight: 48,
    padding: 16,
  },
  empty: {
    color: colors.muted,
    fontSize: type.small,
  },
});
