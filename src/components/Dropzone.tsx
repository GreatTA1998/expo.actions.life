import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { matchHabitTemplates } from '../services/seed';
import { colors, type } from '../theme';
import { HOLD_DELAY, useDragDrop } from './drag/DragDropContext';

type CreateExtras = { duration?: number };

type Props = {
  zoneId: string;
  parentID: string;
  index: number;
  depth: number;
  composing: boolean;
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
  onCompose,
  onSubmit,
  onCancel,
}: Props) {
  const { registerZone, bestId, refreshZones } = useDragDrop();
  const ref = useRef<View>(null);
  const picking = useRef(false);
  const [draft, setDraft] = useState('');
  const root = depth === 0;
  const highlighted = bestId === zoneId;
  const templates = matchHabitTemplates(draft);

  useEffect(() => {
    return registerZone({
      id: zoneId,
      target: { kind: 'list', parentID, index },
      ref,
    });
  }, [index, parentID, registerZone, zoneId]);

  useEffect(() => {
    if (!composing) setDraft('');
  }, [composing]);

  function commit(name: string, extras?: CreateExtras) {
    if (name) onSubmit(name, extras);
    else onCancel();
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
        highlighted && styles.hot,
        composing && styles.composing,
      ]}
    >
      {composing ? (
        <View style={styles.composer}>
          <TextInput
            autoFocus
            value={draft}
            onChangeText={setDraft}
            placeholder="New task"
            placeholderTextColor={colors.faint}
            style={[styles.input, root ? styles.inputRoot : styles.inputNested]}
            onSubmitEditing={() => commit(draft.trim())}
            onBlur={() => {
              setTimeout(() => {
                if (picking.current) return;
                commit(draft.trim());
              }, 50);
            }}
            returnKeyType="done"
          />
          {templates.length ? (
            <View style={styles.menu} testID="template-menu">
              {templates.map((habit) => (
                <Pressable
                  key={habit.id}
                  testID={`template-${habit.id}`}
                  onPressIn={() => {
                    picking.current = true;
                  }}
                  onPress={() => {
                    commit(habit.name, { duration: habit.duration });
                    picking.current = false;
                  }}
                  style={styles.menuItem}
                >
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
  hot: {
    backgroundColor: colors.dropPreview,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
  },
  composing: {
    minHeight: 36,
    borderWidth: 2,
    borderColor: colors.composer,
    backgroundColor: colors.card,
    zIndex: 6,
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
    paddingHorizontal: 8,
    paddingVertical: 4,
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
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 10,
  },
  menuText: {
    color: colors.ink,
    fontSize: 12,
  },
});
