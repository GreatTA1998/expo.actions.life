import { useEffect, useRef, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { colors, type } from '../theme';
import { HOLD_DELAY, useDragDrop } from './drag/DragDropContext';

type Props = {
  zoneId: string;
  parentID: string;
  index: number;
  depth: number;
  composing: boolean;
  onCompose: () => void;
  onSubmit: (name: string) => void;
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
  const [draft, setDraft] = useState('');
  const root = depth === 0;
  const highlighted = bestId === zoneId;

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
        <TextInput
          autoFocus
          value={draft}
          onChangeText={setDraft}
          placeholder="New task"
          placeholderTextColor={colors.faint}
          style={styles.input}
          onSubmitEditing={() => {
            const name = draft.trim();
            if (name) onSubmit(name);
            else onCancel();
          }}
          onBlur={() => {
            const name = draft.trim();
            if (name) onSubmit(name);
            else onCancel();
          }}
          returnKeyType="done"
        />
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
    fontSize: type.body,
  },
});
