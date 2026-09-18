import { useEffect, useRef, useState, type ReactNode } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { clampSplitFraction, SPLIT_HANDLE_PX } from '../dates';
import { colors } from '../theme';

type Props = {
  split: number;
  onChange: (value: number) => void;
  top: ReactNode;
  bottom: ReactNode;
};

/**
 * Visual split updates locally while dragging (web ResizeBoundary onInput).
 * Persist via onChange only on release — store.notify on every move re-renders
 * the full inbox/calendar forest and is what made large accounts lag.
 */
export function SplitPane({ split, onChange, top, bottom }: Props) {
  const [visual, setVisual] = useState(split);
  const start = useRef(split);
  const height = useRef(1);
  const visualRef = useRef(split);
  const dragging = useRef(false);
  visualRef.current = visual;

  useEffect(() => {
    if (dragging.current) return;
    setVisual(split);
    visualRef.current = split;
  }, [split]);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        dragging.current = true;
        start.current = visualRef.current;
      },
      onPanResponderMove: (_, gesture) => {
        if (!height.current) return;
        const remaining = Math.max(1, height.current - SPLIT_HANDLE_PX);
        const next = clampSplitFraction(start.current - gesture.dy / remaining, height.current);
        visualRef.current = next;
        setVisual(next);
      },
      onPanResponderRelease: () => {
        dragging.current = false;
        onChange(visualRef.current);
      },
      onPanResponderTerminate: () => {
        dragging.current = false;
        onChange(visualRef.current);
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
      <View style={[styles.pane, { flex: 1 - visual }]}>{top}</View>
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
      <View style={[styles.pane, { flex: visual }]}>{bottom}</View>
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
