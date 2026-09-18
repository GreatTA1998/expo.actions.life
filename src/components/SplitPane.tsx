import { useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { clampSplitFraction, SPLIT_HANDLE_PX } from '../dates';
import { colors } from '../theme';

type Props = {
  split: number;
  onChange: (value: number) => void;
  top: ReactNode;
  bottom: ReactNode;
};

export function SplitPane({ split, onChange, top, bottom }: Props) {
  const start = useRef(split);
  const height = useRef(1);
  const splitRef = useRef(split);
  splitRef.current = split;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        start.current = splitRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        if (!height.current) return;
        const remaining = Math.max(1, height.current - SPLIT_HANDLE_PX);
        const next = start.current - gesture.dy / remaining;
        onChange(clampSplitFraction(next, height.current));
      },
    }),
  ).current;

  return (
    <View
      style={styles.col}
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
      }}
    >
      <View style={[styles.pane, { flex: 1 - split }]}>{top}</View>
      <View
        {...pan.panHandlers}
        style={styles.handle}
        testID="split-handle"
        accessibilityLabel="Resize list and calendar"
      >
        <View style={styles.grip} testID="split-grip">
          <View style={styles.bar} />
          <View style={styles.bar} />
          <View style={styles.bar} />
        </View>
      </View>
      <View style={[styles.pane, { flex: split }]}>{bottom}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  col: {
    flex: 1,
  },
  pane: {
    overflow: 'hidden',
  },
  handle: {
    height: SPLIT_HANDLE_PX,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navbar,
    zIndex: 4,
  },
  grip: {
    width: SPLIT_HANDLE_PX,
    height: SPLIT_HANDLE_PX,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  bar: {
    width: 36,
    height: 2,
    backgroundColor: colors.ink,
    borderRadius: 1,
  },
});
