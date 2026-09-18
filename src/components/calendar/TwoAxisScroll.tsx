import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type ReactNode,
} from 'react';
import {
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';

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
  /** Fires when native momentum / drag settles — used to shrink sticky header band. */
  onScrollIdle?: () => void;
};

type ScrollNative = ScrollView & {
  setNativeProps?: (props: object) => void;
};

/**
 * Dual-axis calendar scroller.
 *
 * Native: nested UIScrollViews so ordinary pans keep **native momentum**.
 * No JS responder capture, no rAF friction, no per-frame drag work.
 *
 * Web: single overflow:auto surface (true diagonal), matching `#scroll-parent`.
 *
 * Ownership: scroll only. Drag lock calls `setEnabled(false)`; sticky chrome
 * follows via `onOffsetChange` (caller paints with setNativeProps).
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
    onScrollIdle,
  },
  ref,
) {
  const webScrollRef = useRef<View>(null);
  const yScrollRef = useRef<ScrollView>(null);
  const xScrollRef = useRef<ScrollView>(null);
  const size = useRef({ width: 0, height: 0 });
  const offsetRef = useRef<ScrollOffset>(initialOffset);
  const enabledRef = useRef(scrollEnabled);
  enabledRef.current = scrollEnabled;
  const onOffsetRef = useRef(onOffsetChange);
  onOffsetRef.current = onOffsetChange;
  const onScrollIdleRef = useRef(onScrollIdle);
  onScrollIdleRef.current = onScrollIdle;
  const suppressEmit = useRef(false);
  const axesDragging = useRef({ x: false, y: false });

  const emitIdle = useCallback(() => {
    if (axesDragging.current.x || axesDragging.current.y) return;
    onScrollIdleRef.current?.();
  }, []);

  const maxX = () => Math.max(0, contentWidth - size.current.width);
  const maxY = () => Math.max(0, contentHeight - size.current.height);

  const clamp = useCallback(
    (x: number, y: number): ScrollOffset => ({
      x: Math.max(0, Math.min(maxX(), x)),
      y: Math.max(0, Math.min(maxY(), y)),
    }),
    [contentHeight, contentWidth],
  );

  const emit = useCallback((next: ScrollOffset) => {
    offsetRef.current = next;
    onOffsetRef.current?.(next);
  }, []);

  const applyEnabled = useCallback((enabled: boolean) => {
    enabledRef.current = enabled;
    (yScrollRef.current as ScrollNative | null)?.setNativeProps?.({ scrollEnabled: enabled });
    (xScrollRef.current as ScrollNative | null)?.setNativeProps?.({ scrollEnabled: enabled });
    if (Platform.OS === 'web') {
      const node = webScrollRef.current as (View & { setNativeProps?: (p: object) => void }) | null;
      node?.setNativeProps?.({
        style: { overflow: enabled ? 'auto' : 'hidden' } as object,
      });
    }
  }, []);

  useEffect(() => {
    applyEnabled(scrollEnabled);
  }, [applyEnabled, scrollEnabled]);

  useImperativeHandle(
    ref,
    () => ({
      scrollTo: (next) => {
        const clamped = clamp(next.x, next.y);
        offsetRef.current = clamped;
        suppressEmit.current = true;
        if (Platform.OS === 'web') {
          const node = webScrollRef.current as (View & { scrollTo?: (o: object) => void }) | null;
          node?.scrollTo?.({ x: clamped.x, y: clamped.y, animated: false });
        } else {
          yScrollRef.current?.scrollTo({ y: clamped.y, animated: false });
          xScrollRef.current?.scrollTo({ x: clamped.x, animated: false });
        }
        onOffsetRef.current?.(clamped);
        requestAnimationFrame(() => {
          suppressEmit.current = false;
        });
      },
      getOffset: () => offsetRef.current,
      setEnabled: (enabled) => {
        applyEnabled(enabled);
      },
    }),
    [applyEnabled, clamp],
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
            if (!enabledRef.current || suppressEmit.current) return;
            const { contentOffset } = event.nativeEvent;
            emit(clamp(contentOffset.x, contentOffset.y));
          },
          scrollEventThrottle: 16,
        } as object)}
      >
        <View style={{ width: contentWidth, height: contentHeight }}>{children}</View>
      </View>
    );
  }

  function onYScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (suppressEmit.current) return;
    const y = event.nativeEvent.contentOffset.y;
    emit({ x: offsetRef.current.x, y });
  }

  function onXScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    if (suppressEmit.current) return;
    const x = event.nativeEvent.contentOffset.x;
    emit({ x, y: offsetRef.current.y });
  }

  function onAxisDragBegin(axis: 'x' | 'y') {
    axesDragging.current[axis] = true;
  }

  function onAxisEndDrag(axis: 'x' | 'y', event: NativeSyntheticEvent<NativeScrollEvent>) {
    axesDragging.current[axis] = false;
    const velocity = event.nativeEvent.velocity;
    const coasting =
      !!velocity && (Math.abs(velocity.x ?? 0) > 0.05 || Math.abs(velocity.y ?? 0) > 0.05);
    if (!coasting) emitIdle();
  }

  function onAxisMomentumEnd(axis: 'x' | 'y') {
    axesDragging.current[axis] = false;
    emitIdle();
  }

  return (
    <View
      collapsable={false}
      style={styles.viewport}
      onLayout={(event) => {
        const { width, height } = event.nativeEvent.layout;
        size.current = { width, height };
        onViewportLayout?.({ width, height });
      }}
    >
      <ScrollView
        ref={yScrollRef}
        style={styles.viewport}
        scrollEnabled={scrollEnabled}
        showsVerticalScrollIndicator={false}
        // Let the native scroller cancel child presses when the finger moves —
        // do not attach a JS pan responder here (that killed momentum).
        canCancelContentTouches={scrollEnabled}
        onScroll={onYScroll}
        onScrollBeginDrag={() => onAxisDragBegin('y')}
        onScrollEndDrag={(event) => onAxisEndDrag('y', event)}
        onMomentumScrollEnd={() => onAxisMomentumEnd('y')}
        scrollEventThrottle={16}
        testID={testID ? `${testID}-y` : undefined}
      >
        <ScrollView
          ref={xScrollRef}
          horizontal
          nestedScrollEnabled
          style={{ height: contentHeight }}
          contentContainerStyle={{ width: contentWidth, height: contentHeight }}
          scrollEnabled={scrollEnabled}
          showsHorizontalScrollIndicator={false}
          canCancelContentTouches={scrollEnabled}
          onScroll={onXScroll}
          onScrollBeginDrag={() => onAxisDragBegin('x')}
          onScrollEndDrag={(event) => onAxisEndDrag('x', event)}
          onMomentumScrollEnd={() => onAxisMomentumEnd('x')}
          scrollEventThrottle={16}
          testID={testID}
          directionalLockEnabled
        >
          <View style={{ width: contentWidth, height: contentHeight }}>{children}</View>
        </ScrollView>
      </ScrollView>
    </View>
  );
});

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
});
