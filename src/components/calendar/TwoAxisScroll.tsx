import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import { Platform, StyleSheet, View } from 'react-native';

export type ScrollOffset = { x: number; y: number };

export type TwoAxisScrollHandle = {
  scrollTo: (next: ScrollOffset) => void;
  getOffset: () => ScrollOffset;
  setEnabled: (enabled: boolean) => void;
};

type Props = {
  contentWidth: number;
  contentHeight: number;
  initialOffset?: ScrollOffset;
  scrollEnabled: boolean;
  children: ReactNode;
  testID?: string;
  onOffsetChange?: (next: ScrollOffset) => void;
  onViewportLayout?: (size: { width: number; height: number }) => void;
};

const FRICTION = 0.92;
const STOP = 0.35;
const MOVE_SLOP = 4;

/**
 * One scroll surface for both axes (web `#scroll-parent` parity).
 * Diagonal pans move days (x) and hours (y) together — no nested ScrollViews.
 */
export const TwoAxisScroll = forwardRef<TwoAxisScrollHandle, Props>(function TwoAxisScroll(
  {
    contentWidth,
    contentHeight,
    initialOffset = { x: 0, y: 0 },
    scrollEnabled,
    children,
    testID,
    onOffsetChange,
    onViewportLayout,
  },
  ref,
) {
  const viewportRef = useRef<View>(null);
  const contentRef = useRef<View>(null);
  const webScrollRef = useRef<View>(null);
  const size = useRef({ width: 0, height: 0 });
  const offsetRef = useRef<ScrollOffset>(initialOffset);
  const enabledRef = useRef(scrollEnabled);
  enabledRef.current = scrollEnabled;
  const onOffsetRef = useRef(onOffsetChange);
  onOffsetRef.current = onOffsetChange;
  const dragging = useRef(false);
  const start = useRef({ x: 0, y: 0, ox: 0, oy: 0 });
  const velocity = useRef({ x: 0, y: 0 });
  const lastMove = useRef({ t: 0, x: 0, y: 0 });
  const momentumRaf = useRef(0);

  const maxX = () => Math.max(0, contentWidth - size.current.width);
  const maxY = () => Math.max(0, contentHeight - size.current.height);

  const paintNative = useCallback((next: ScrollOffset) => {
    const node = contentRef.current as (View & { setNativeProps?: (p: object) => void }) | null;
    node?.setNativeProps?.({
      style: {
        transform: [{ translateX: -next.x }, { translateY: -next.y }],
      },
    });
  }, []);

  const clamp = useCallback(
    (x: number, y: number): ScrollOffset => ({
      x: Math.max(0, Math.min(maxX(), x)),
      y: Math.max(0, Math.min(maxY(), y)),
    }),
    [contentHeight, contentWidth],
  );

  const emit = useCallback(
    (next: ScrollOffset) => {
      offsetRef.current = next;
      if (Platform.OS !== 'web') paintNative(next);
      onOffsetRef.current?.(next);
    },
    [paintNative],
  );

  const commit = useCallback(
    (x: number, y: number) => {
      const next = clamp(x, y);
      emit(next);
      return next;
    },
    [clamp, emit],
  );

  const stopMomentum = useCallback(() => {
    if (momentumRaf.current) {
      cancelAnimationFrame(momentumRaf.current);
      momentumRaf.current = 0;
    }
  }, []);

  const runMomentum = useCallback(() => {
    stopMomentum();
    const step = () => {
      if (!enabledRef.current) {
        momentumRaf.current = 0;
        return;
      }
      velocity.current.x *= FRICTION;
      velocity.current.y *= FRICTION;
      if (Math.abs(velocity.current.x) < STOP && Math.abs(velocity.current.y) < STOP) {
        momentumRaf.current = 0;
        return;
      }
      const cur = offsetRef.current;
      commit(cur.x - velocity.current.x, cur.y - velocity.current.y);
      momentumRaf.current = requestAnimationFrame(step);
    };
    momentumRaf.current = requestAnimationFrame(step);
  }, [commit, stopMomentum]);

  useEffect(() => () => stopMomentum(), [stopMomentum]);

  useEffect(() => {
    if (!scrollEnabled) stopMomentum();
  }, [scrollEnabled, stopMomentum]);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo: (next) => {
        stopMomentum();
        const clamped = clamp(next.x, next.y);
        emit(clamped);
        if (Platform.OS === 'web') {
          const node = webScrollRef.current as (View & { scrollTo?: (o: object) => void }) | null;
          node?.scrollTo?.({ x: clamped.x, y: clamped.y, animated: false });
        }
      },
      getOffset: () => offsetRef.current,
      setEnabled: (enabled) => {
        enabledRef.current = enabled;
        if (!enabled) stopMomentum();
        if (Platform.OS === 'web') {
          const node = webScrollRef.current as (View & { setNativeProps?: (p: object) => void }) | null;
          node?.setNativeProps?.({
            style: { overflow: enabled ? 'auto' : 'hidden' } as object,
          });
        }
      },
    }),
    [clamp, emit, stopMomentum],
  );

  // Web: overflow:auto is the true dual-axis surface.
  if (Platform.OS === 'web') {
    return (
      <View
        ref={webScrollRef}
        testID={testID}
        style={[styles.viewport, { overflow: scrollEnabled ? 'auto' : 'hidden' } as object]}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          size.current = { width, height };
          onViewportLayout?.({ width, height });
        }}
        {...({
          onScroll: (event: { nativeEvent: { contentOffset: ScrollOffset } }) => {
            if (!enabledRef.current) return;
            const { contentOffset } = event.nativeEvent;
            const next = clamp(contentOffset.x, contentOffset.y);
            offsetRef.current = next;
            onOffsetRef.current?.(next);
          },
          scrollEventThrottle: 16,
        } as object)}
      >
        <View style={{ width: contentWidth, height: contentHeight }}>{children}</View>
      </View>
    );
  }

  const panOrigin = useRef<{ x: number; y: number } | null>(null);

  function beginPan(pageX: number, pageY: number) {
    if (!enabledRef.current) return;
    stopMomentum();
    dragging.current = true;
    start.current = {
      x: pageX,
      y: pageY,
      ox: offsetRef.current.x,
      oy: offsetRef.current.y,
    };
    lastMove.current = { t: Date.now(), x: pageX, y: pageY };
    velocity.current = { x: 0, y: 0 };
  }

  function movePan(pageX: number, pageY: number) {
    if (!dragging.current || !enabledRef.current) return;
    const dx = pageX - start.current.x;
    const dy = pageY - start.current.y;
    const now = Date.now();
    const dt = Math.max(1, now - lastMove.current.t);
    velocity.current = {
      x: ((pageX - lastMove.current.x) / dt) * 16,
      y: ((pageY - lastMove.current.y) / dt) * 16,
    };
    lastMove.current = { t: now, x: pageX, y: pageY };
    commit(start.current.ox - dx, start.current.oy - dy);
  }

  function endPan() {
    if (!dragging.current) return;
    dragging.current = false;
    panOrigin.current = null;
    if (enabledRef.current) runMomentum();
  }

  return (
    <View
      ref={viewportRef}
      collapsable={false}
      testID={testID}
      style={styles.viewport}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        size.current = { width, height };
        onViewportLayout?.({ width, height });
      }}
      onStartShouldSetResponder={() => false}
      onTouchStart={(event) => {
        if (!enabledRef.current) return;
        const touch = event.nativeEvent.touches[0];
        if (touch) panOrigin.current = { x: touch.pageX, y: touch.pageY };
      }}
      onMoveShouldSetResponderCapture={(event) => {
        if (!enabledRef.current || !panOrigin.current) return false;
        const touch = event.nativeEvent.touches[0];
        if (!touch) return false;
        const dx = touch.pageX - panOrigin.current.x;
        const dy = touch.pageY - panOrigin.current.y;
        return Math.abs(dx) > MOVE_SLOP || Math.abs(dy) > MOVE_SLOP;
      }}
      onResponderTerminationRequest={() => !dragging.current}
      onResponderGrant={(event) => {
        beginPan(event.nativeEvent.pageX, event.nativeEvent.pageY);
      }}
      onResponderMove={(event) => movePan(event.nativeEvent.pageX, event.nativeEvent.pageY)}
      onResponderRelease={endPan}
      onResponderTerminate={() => {
        dragging.current = false;
        panOrigin.current = null;
        stopMomentum();
      }}
    >
      <View
        ref={contentRef}
        collapsable={false}
        style={[
          styles.content,
          {
            width: contentWidth,
            height: contentHeight,
            transform: [{ translateX: -offsetRef.current.x }, { translateY: -offsetRef.current.y }],
          },
        ]}
      >
        {children}
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
  },
});
