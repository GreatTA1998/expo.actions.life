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
  onCreate: (slot: { parentID: string; index: number }, name: string) => void;
  revealTopToken?: number;
};

export function Inbox({
  forest,
  onToggleDone,
  onToggleCollapsed,
  onOpen,
  onMenu,
  onCreate,
  revealTopToken,
}: Props) {
  const scrollRef = useRef<ScrollView>(null);
  const wrapRef = useRef<View>(null);
  const offset = useRef({ x: 0, y: 0 });
  const viewport = useRef<Rect | null>(null);
  const [composer, setComposer] = useState<ComposerSlot>(null);
  const { registerScroller, refreshZones } = useDragDrop();

  useEffect(() => {
    if (!revealTopToken) return;
    scrollRef.current?.scrollTo({ y: 0, animated: true });
  }, [revealTopToken]);

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
              zoneId={`list-root-${i}`}
              parentID=""
              index={i}
              depth={0}
              composing={composer?.parentID === '' && composer.index === i}
              onCompose={() => setComposer({ parentID: '', index: i })}
              onSubmit={(name) => {
                onCreate({ parentID: '', index: i }, name);
                setComposer(null);
              }}
              onCancel={() => setComposer(null)}
            />
            <TaskRow
              node={node}
              depth={0}
              composer={composer}
              onCompose={setComposer}
              onCreate={(slot, name) => {
                onCreate(slot, name);
                setComposer(null);
              }}
              onToggleDone={onToggleDone}
              onToggleCollapsed={onToggleCollapsed}
              onOpen={onOpen}
              onMenu={onMenu}
            />
          </View>
        ))}
        <Dropzone
          zoneId={`list-root-${forest.length}`}
          parentID=""
          index={forest.length}
          depth={0}
          composing={composer?.parentID === '' && composer.index === forest.length}
          onCompose={() => setComposer({ parentID: '', index: forest.length })}
          onSubmit={(name) => {
            onCreate({ parentID: '', index: forest.length }, name);
            setComposer(null);
          }}
          onCancel={() => setComposer(null)}
        />
        {forest.length === 0 && !composer ? (
          <Pressable onPress={() => setComposer({ parentID: '', index: 0 })} style={styles.emptyHit}>
            <Text style={styles.empty}>Tap the empty space to add a task</Text>
          </Pressable>
        ) : null}
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
    padding: 16,
  },
  empty: {
    color: colors.muted,
    fontSize: type.small,
  },
});
