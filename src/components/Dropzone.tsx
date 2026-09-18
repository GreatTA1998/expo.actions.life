import { useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { matchHabitTemplates } from '../services/seed';
import { colors, type } from '../theme';
import { createComposerLock } from './composerLock';
import { HOLD_DELAY, useDragDrop } from './drag/DragDropContext';
import { useZoneHighlight } from './drag/useZoneHighlight';

type CreateExtras = { duration?: number };

type Props = {
  zoneId: string;
  parentID: string;
  index: number;
  depth: number;
  composing: boolean;
  ghost?: boolean;
  onCompose: () => void;
  onSubmit: (name: string, extras?: CreateExtras) => void;
  onCancel: () => void;
};

export function Dropzone({
  zoneId,
  parentID,
  index,
  depth,
  composing,
  ghost = false,
  onCompose,
  onSubmit,
  onCancel,
}: Props) {
  const { registerZone, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const picking = useRef(false);
  const alive = useRef(true);
  const lock = useRef(createComposerLock()).current;
  const draftRef = useRef('');
  const composingRef = useRef(composing);
  const wasComposing = useRef(composing);
  const [draft, setDraft] = useState('');
  composingRef.current = composing;
  const root = depth === 0;
  const highlighted = useZoneHighlight(zoneId);
  const templates = matchHabitTemplates(draft);

  function setDraftValue(value: string) {
    draftRef.current = value;
    setDraft(value);
  }

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
      target: { kind: 'list', parentID, index },
      ref,
    });
  }, [index, parentID, registerZone, zoneId]);

  useEffect(() => {
    if (composing && !wasComposing.current) {
      lock.beginCompose();
      setDraftValue('');
    }
    wasComposing.current = composing;
  }, [composing, lock]);

  function commit(name: string, keepOpen: boolean, extras?: CreateExtras) {
    if (!lock.commit()) return;
    picking.current = false;
    if (name) {
      onSubmit(name, extras);
      setDraftValue('');
      if (!keepOpen) onCancel();
    } else if (composingRef.current) {
      onCancel();
    }
  }

  return (
    <View
      ref={ref}
      collapsable={false}
      nativeID={zoneId}
      testID={`dropzone-${parentID || 'root'}-${index}`}
      onLayout={() => refreshZones()}
      style={[
        styles.zone,
        root ? styles.root : styles.sub,
        ghost && styles.ghost,
        highlighted && styles.hot,
        composing && styles.composing,
      ]}
    >
      {composing ? (
        <View style={styles.composer}>
          <TextInput
            autoFocus
            blurOnSubmit={false}
            value={draft}
            onChangeText={setDraftValue}
            placeholder="New task"
            placeholderTextColor={colors.faint}
            style={[styles.input, root ? styles.inputRoot : styles.inputNested]}
            onSubmitEditing={() => commit(draftRef.current.trim(), true)}
            onEndEditing={() => {
              const name = draftRef.current.trim();
              lock.scheduleBlur(() => {
                if (!alive.current || picking.current) return;
                commit(name, false);
              });
            }}
            onBlur={() => {
              const name = draftRef.current.trim();
              lock.scheduleBlur(() => {
                if (!alive.current || picking.current) return;
                commit(name, false);
              });
            }}
            returnKeyType="done"
          />
          {templates.length ? (
            <View style={styles.menu} testID="template-menu">
              {templates.map((habit) => (
                <Pressable
                  key={habit.id}
                  testID={`template-${habit.id}`}
                  {...({
                    onMouseDown: (event: { preventDefault?: () => void }) => {
                      event.preventDefault?.();
                      picking.current = true;
                    },
                    onPointerDown: (event: { preventDefault?: () => void }) => {
                      event.preventDefault?.();
                      picking.current = true;
                    },
                  } as object)}
                  onPressIn={() => {
                    picking.current = true;
                  }}
                  onPress={() => {
                    commit(habit.name, false, { duration: habit.duration });
                  }}
                  style={styles.menuItem}
                >
                  {habit.iconURL ? (
                    <Image source={{ uri: habit.iconURL }} style={styles.menuIcon} />
                  ) : null}
                  <Text style={styles.menuText}>{habit.name}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={parentID ? 'Add a subtask here' : 'Add a task here'}
          onPress={onCompose}
          delayLongPress={HOLD_DELAY}
          style={styles.hit}
        >
          {highlighted ? <Text style={styles.hint}>{parentID ? 'Nest here' : 'Drop here'}</Text> : null}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  zone: {
    borderRadius: 6,
  },
  root: {
    minHeight: 24,
  },
  sub: {
    minHeight: 16,
  },
  ghost: {
    marginTop: -16,
    zIndex: 3,
  },
  hot: {
    backgroundColor: colors.dropPreview,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
  },
  composing: {
    borderWidth: 2,
    borderColor: colors.composer,
    backgroundColor: colors.card,
    zIndex: 6,
    minHeight: Platform.OS === 'web' ? 16 : 32,
  },
  composer: {
    flex: 1,
  },
  hit: {
    flex: 1,
    minHeight: Platform.OS === 'web' ? 16 : 20,
    justifyContent: 'center',
  },
  hint: {
    textAlign: 'center',
    color: colors.accent,
    fontSize: type.micro,
  },
  input: {
    flex: 1,
    paddingHorizontal: 6,
    paddingVertical: 0,
    color: colors.ink,
  },
  inputRoot: {
    fontSize: type.body,
  },
  inputNested: {
    fontSize: 14,
  },
  menu: {
    position: 'absolute',
    top: '100%',
    left: 0,
    width: 200,
    maxHeight: 220,
    backgroundColor: colors.card,
    borderRadius: 12,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 20,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  menuIcon: {
    width: 24,
    height: 24,
  },
  menuText: {
    color: colors.ink,
    fontSize: 12,
  },
});
