import { useRef, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
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
        const next = start.current - gesture.dy / height.current;
        onChange(Math.min(0.85, Math.max(0.2, next)));
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
          <View style={[styles.bar, styles.barShort]} />
          <View style={styles.bar} />
          <View style={[styles.bar, styles.barShort]} />
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
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.navbar,
    zIndex: 4,
  },
  grip: {
    width: 36,
    height: 14,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  bar: {
    width: 36,
    height: 1.5,
    backgroundColor: colors.ink,
    borderRadius: 1,
  },
  barShort: {
    width: 24,
  },
});
