import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../../theme';
import type { TaskRecord } from '../../models/types';
import { resolveDrop, type DragOrigin, type DragSession, type DropTarget } from './commitDrop';
import { edgeScrollDelta, readWindowRect, type Rect } from './geometry';
import { paintGhostNative } from './ghostPaint';
import { createDragGesture } from './gesture';
import { hitTestZones } from './hitTest';
import { setScrollersEnabled, type Scroller } from './scrollGate';

export type { DragOrigin, DragSession, DropTarget, Rect };
export type { Scroller } from './scrollGate';

type Zone = {
  id: string;
  target: DropTarget;
  ref: RefObject<View | null>;
  ownerTaskId?: string;
  rect: Rect | null;
};

type DragContextValue = {
  drag: DragSession | null;
  pointerLocked: boolean;
  scrollLocked: boolean;
  registerZone: (zone: Omit<Zone, 'rect'>) => () => void;
  registerScroller: (scroller: Scroller) => () => void;
  armDrag: (
    task: TaskRecord,
    origin: DragOrigin,
    pageX: number,
    pageY: number,
    rect: Rect,
    gesture?: number,
  ) => void;
  activateDrag: (gesture?: number) => number;
  moveDrag: (pageX: number, pageY: number) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  refreshZones: () => void;
  /** Disable inbox/calendar scroll while duration-resizing (web preventTouchScroll). */
  setScrollLocked: (locked: boolean) => void;
  getDragSession: () => DragSession | null;
  getBestId: () => string;
  /** Highlight updates without putting bestId on the shared context value. */
  subscribeBestId: (listener: (id: string) => void) => () => void;
  /** Per-frame drag motion without React re-rendering the forest. */
  subscribeDragMotion: (listener: () => void) => () => void;
};

const DragContext = createContext<DragContextValue | null>(null);
const MOUSE_SLOP = 2;
const TOUCH_SLOP = 5;
const EDGE = 44;
const SCROLL_PX = 16;

function emptySession(): DragSession | null {
  return null;
}

export function useDragDrop(): DragContextValue {
  const ctx = useContext(DragContext);
  if (!ctx) throw new Error('useDragDrop must be used inside DragDropProvider');
  return ctx;
}

export function useDragDropOptional(): DragContextValue | null {
  return useContext(DragContext);
}

type ProviderProps = {
  children: ReactNode;
  onDrop: (
    taskId: string,
    origin: DragOrigin,
    target: DropTarget,
    pointer: { x: number; y: number },
    zoneRect: Rect | null,
  ) => void;
};

type GhostNative = View & {
  setNativeProps?: (props: { style?: object; transform?: object[] }) => void;
};

export function DragDropProvider({ children, onDrop }: ProviderProps) {
  const [drag, setDrag] = useState<DragSession | null>(emptySession);
  const [pointerLocked, setPointerLocked] = useState(false);
  const [scrollLocked, setScrollLockedState] = useState(false);
  const [ghostTransform, setGhostTransform] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [ghostBestId, setGhostBestId] = useState('');
  const dragRef = useRef<DragSession | null>(null);
  const bestRef = useRef('');
  const pendingActivate = useRef(false);
  const gesture = useRef(createDragGesture()).current;
  const zones = useRef(new Map<string, Zone>());
  const scrollers = useRef(new Map<string, Scroller>());
  const onDropRef = useRef(onDrop);
  const layerRef = useRef<View>(null);
  const layerOrigin = useRef({ x: 0, y: 0 });
  const ghostRef = useRef<GhostNative | null>(null);
  const moveRaf = useRef(0);
  const refreshRaf = useRef(0);
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  const motionListeners = useRef(new Set<() => void>());
  const bestListeners = useRef(new Set<(id: string) => void>());
  onDropRef.current = onDrop;

  const measureLayer = useCallback(() => {
    const node = layerRef.current as (View & { measureInWindow?: Function }) | null;
    const sync = readWindowRect(node);
    if (sync) {
      layerOrigin.current = { x: sync.x, y: sync.y };
      return;
    }
    node?.measureInWindow?.((x: number, y: number) => {
      layerOrigin.current = { x, y };
    });
  }, []);

  const paintGhost = useCallback((session: DragSession) => {
    if (Platform.OS === 'web') {
      const local = paintGhostNative(null, session, layerOrigin.current);
      setGhostTransform(local);
      return;
    }
    paintGhostNative(ghostRef.current, session, layerOrigin.current);
  }, []);

  const notifyDragMotion = useCallback(() => {
    for (const listener of motionListeners.current) listener();
  }, []);

  const notifyBestId = useCallback((id: string) => {
    for (const listener of bestListeners.current) listener(id);
  }, []);

  const getDragSession = useCallback(() => dragRef.current, []);
  const getBestId = useCallback(() => bestRef.current, []);

  const subscribeBestId = useCallback((listener: (id: string) => void) => {
    bestListeners.current.add(listener);
    return () => {
      bestListeners.current.delete(listener);
    };
  }, []);

  const subscribeDragMotion = useCallback((listener: () => void) => {
    motionListeners.current.add(listener);
    return () => {
      motionListeners.current.delete(listener);
    };
  }, []);

  const measureAllZones = useCallback(() => {
    for (const zone of zones.current.values()) {
      const node = zone.ref.current as (View & { measureInWindow?: Function }) | null;
      const sync = readWindowRect(node, zone.id);
      if (sync) {
        zone.rect = sync;
        continue;
      }
      node?.measureInWindow?.((x: number, y: number, width: number, height: number) => {
        zone.rect = { x, y, width, height };
      });
    }
  }, []);

  /**
   * Idle onLayout from every Dropzone/TaskRow used to remeasure the whole forest
   * (O(n) layouts × O(n) measures). Only measure while a drag is live, and at most
   * once per animation frame.
   */
  const refreshZones = useCallback(() => {
    if (!dragRef.current?.active && !pendingActivate.current) return;
    if (refreshRaf.current) return;
    refreshRaf.current = requestAnimationFrame(() => {
      refreshRaf.current = 0;
      measureAllZones();
    });
  }, [measureAllZones]);

  const refreshZonesNow = useCallback(() => {
    if (refreshRaf.current) {
      cancelAnimationFrame(refreshRaf.current);
      refreshRaf.current = 0;
    }
    measureAllZones();
  }, [measureAllZones]);

  const pickZone = useCallback((session: DragSession) => {
    const best = hitTestZones(session, zones.current.values(), Dimensions.get('window'));
    if (best !== bestRef.current) {
      bestRef.current = best;
      setGhostBestId(best);
      notifyBestId(best);
    }
  }, [notifyBestId]);

  const lockScrollers = useCallback((enabled: boolean) => {
    setScrollersEnabled(scrollers.current.values(), enabled);
  }, []);

  const setScrollLocked = useCallback(
    (locked: boolean) => {
      setScrollLockedState(locked);
      lockScrollers(!locked);
    },
    [lockScrollers],
  );

  const publishDrag = useCallback((session: DragSession | null) => {
    dragRef.current = session;
    setDrag(session);
    if (session?.active) paintGhost(session);
  }, [paintGhost]);

  const armDrag = useCallback(
    (task: TaskRecord, origin: DragOrigin, pageX: number, pageY: number, rect: Rect, token?: number) => {
      if (token != null && !gesture.live(token)) return;
      if (token == null && Platform.OS !== 'web' && !pendingActivate.current) return;
      measureLayer();
      const session: DragSession = {
        id: task.id,
        name: task.name,
        origin,
        active: pendingActivate.current,
        pointerX: pageX,
        pointerY: pageY,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        offsetX: pageX - rect.x,
        offsetY: pageY - rect.y,
      };
      pendingActivate.current = false;
      publishDrag(session);
      if (session.active) {
        lockScrollers(false);
        setPointerLocked(true);
        refreshZonesNow();
        pickZone(session);
        notifyDragMotion();
      }
    },
    [gesture, lockScrollers, measureLayer, notifyDragMotion, pickZone, publishDrag, refreshZonesNow],
  );

  const activateDrag = useCallback(
    (token?: number) => {
      if (token == null) {
        token = pendingActivate.current ? gesture.current() : gesture.begin();
      }
      if (!gesture.live(token)) return token;
      pendingActivate.current = true;
      lockScrollers(false);
      setPointerLocked(true);
      measureLayer();
      const session = dragRef.current;
      if (!session) return token;
      if (session.active) return token;
      const next = { ...session, active: true };
      publishDrag(next);
      refreshZonesNow();
      pickZone(next);
      notifyDragMotion();
      return token;
    },
    [gesture, lockScrollers, measureLayer, notifyDragMotion, pickZone, publishDrag, refreshZonesNow],
  );

  const flushMove = useCallback(() => {
    moveRaf.current = 0;
    const pending = pendingMove.current;
    pendingMove.current = null;
    if (!pending) return;
    const current = dragRef.current;
    if (!current?.active) return;
    const next: DragSession = {
      ...current,
      pointerX: pending.x,
      pointerY: pending.y,
      x: pending.x - current.offsetX,
      y: pending.y - current.offsetY,
    };
    dragRef.current = next;
    paintGhost(next);
    // Do not setDrag here — that re-rendered every Dropzone/TaskRow/CalBlock
    // once per frame. Ghost + zone pick + calendar preview use refs/native props.
    pickZone(next);
    notifyDragMotion();
  }, [notifyDragMotion, paintGhost, pickZone]);

  const moveDrag = useCallback(
    (pageX: number, pageY: number) => {
      const session = dragRef.current;
      if (!session) return;
      if (!session.active) {
        const slop = Platform.OS === 'web' ? MOUSE_SLOP : TOUCH_SLOP;
        if (Math.hypot(pageX - session.pointerX, pageY - session.pointerY) > slop) {
          if (Platform.OS === 'web' || pendingActivate.current) activateDrag();
          else {
            pendingActivate.current = false;
            lockScrollers(true);
            setPointerLocked(false);
            dragRef.current = null;
            setDrag(null);
            bestRef.current = '';
            setGhostBestId('');
            notifyBestId('');
            return;
          }
        } else {
          return;
        }
      }
      const current = dragRef.current;
      if (!current?.active) return;
      pendingMove.current = { x: pageX, y: pageY };
      // Keep dragRef live with the pointer. paintGhost on web writes
      // ghostTransform from this session; useLayoutEffect(drag) re-paints from
      // dragRef and must not regress to a stale position.
      const live: DragSession = {
        ...current,
        pointerX: pageX,
        pointerY: pageY,
        x: pageX - current.offsetX,
        y: pageY - current.offsetY,
      };
      dragRef.current = live;
      paintGhost(live);
      if (!moveRaf.current) {
        moveRaf.current = requestAnimationFrame(flushMove);
      }
    },
    [activateDrag, flushMove, lockScrollers, notifyBestId, paintGhost],
  );

  const cancelDrag = useCallback(() => {
    gesture.cancel();
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    if (refreshRaf.current) {
      cancelAnimationFrame(refreshRaf.current);
      refreshRaf.current = 0;
    }
    pendingMove.current = null;
    dragRef.current = null;
    bestRef.current = '';
    pendingActivate.current = false;
    lockScrollers(true);
    setPointerLocked(false);
    setDrag(null);
    setGhostBestId('');
    notifyBestId('');
    notifyDragMotion();
  }, [gesture, lockScrollers, notifyBestId, notifyDragMotion]);

  const endDrag = useCallback(() => {
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
      flushMove();
    }
    const drop = resolveDrop(dragRef.current, bestRef.current, zones.current);
    if (drop) {
      onDropRef.current(drop.taskId, drop.origin, drop.target, drop.pointer, drop.zoneRect);
    }
    cancelDrag();
  }, [cancelDrag, flushMove]);

  const registerZone = useCallback((zone: Omit<Zone, 'rect'>) => {
    zones.current.set(zone.id, { ...zone, rect: null });
    return () => {
      zones.current.delete(zone.id);
    };
  }, []);

  const registerScroller = useCallback((scroller: Scroller) => {
    scrollers.current.set(scroller.id, scroller);
    return () => {
      scrollers.current.delete(scroller.id);
    };
  }, []);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') return;
    const moveAt = (x: number, y: number, event?: { preventDefault?: () => void }) => {
      if (!dragRef.current) return;
      if (dragRef.current.active) event?.preventDefault?.();
      moveDrag(x, y);
    };
    const onPointerMove = (event: PointerEvent) => moveAt(event.clientX, event.clientY, event);
    const onMouseMove = (event: MouseEvent) => moveAt(event.clientX, event.clientY, event);
    const onTouchMove = (event: TouchEvent) => {
      const touch = event.touches[0];
      if (!touch) return;
      moveAt(touch.clientX, touch.clientY, event);
    };
    const up = () => {
      if (!dragRef.current) return;
      if (dragRef.current.active) endDrag();
      else cancelDrag();
    };
    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', up);
    window.addEventListener('touchmove', onTouchMove, { passive: false });
    window.addEventListener('touchend', up);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', up);
      window.removeEventListener('touchmove', onTouchMove);
      window.removeEventListener('touchend', up);
      window.removeEventListener('pointerup', up);
    };
  }, [cancelDrag, endDrag, moveDrag]);

  useEffect(() => {
    if (!drag?.active) return;
    let raf = 0;
    const tick = () => {
      const session = dragRef.current;
      if (!session?.active) return;
      let moved = false;
      for (const scroller of scrollers.current.values()) {
        const viewport = scroller.getViewport();
        if (!viewport) continue;
        const offset = scroller.getOffset();
        const delta = edgeScrollDelta(
          { x: session.pointerX, y: session.pointerY },
          viewport,
          scroller.axis,
          EDGE,
          SCROLL_PX,
        );
        if (delta === 0) continue;
        const next = {
          x: Math.max(0, offset.x + (scroller.axis === 'x' ? delta : 0)),
          y: Math.max(0, offset.y + (scroller.axis === 'y' ? delta : 0)),
        };
        if (next.x === offset.x && next.y === offset.y) continue;
        scroller.scrollTo(next);
        moved = true;
      }
      if (moved) {
        refreshZonesNow();
        pickZone(session);
        notifyDragMotion();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.active, notifyDragMotion, pickZone, refreshZonesNow]);

  const value = useMemo<DragContextValue>(
    () => ({
      drag,
      pointerLocked,
      scrollLocked,
      registerZone,
      registerScroller,
      armDrag,
      activateDrag,
      moveDrag,
      endDrag,
      cancelDrag,
      refreshZones,
      setScrollLocked,
      getDragSession,
      getBestId,
      subscribeBestId,
      subscribeDragMotion,
    }),
    [
      activateDrag,
      armDrag,
      cancelDrag,
      drag,
      endDrag,
      getBestId,
      getDragSession,
      moveDrag,
      pointerLocked,
      refreshZones,
      registerScroller,
      registerZone,
      scrollLocked,
      setScrollLocked,
      subscribeBestId,
      subscribeDragMotion,
    ],
  );

  const nativeHolding = () => Platform.OS !== 'web' && (pendingActivate.current || !!dragRef.current?.active);

  // Native: setNativeProps only (no React transform). Web: ghostTransform state.
  // dragRef stays live with the pointer so this re-paint cannot regress web state.
  useLayoutEffect(() => {
    const session = dragRef.current;
    if (session?.active) paintGhost(session);
  }, [drag?.active, drag?.id, drag?.name, drag?.width, drag?.height, paintGhost]);

  return (
    <DragContext.Provider value={value}>
      <View
        ref={layerRef}
        collapsable={false}
        style={styles.fill}
        onLayout={measureLayer}
        onStartShouldSetResponderCapture={nativeHolding}
        onMoveShouldSetResponderCapture={nativeHolding}
        onResponderTerminationRequest={() => !nativeHolding()}
        onResponderMove={(event) => moveDrag(event.nativeEvent.pageX, event.nativeEvent.pageY)}
        onResponderRelease={endDrag}
        onResponderTerminate={() => {
          if (Platform.OS !== 'web' && !pendingActivate.current && !dragRef.current?.active) cancelDrag();
        }}
        onTouchEnd={() => {
          if (Platform.OS === 'web') return;
          if (dragRef.current?.active) endDrag();
          else if (pendingActivate.current || pointerLocked) cancelDrag();
        }}
        onTouchCancel={() => {
          if (Platform.OS !== 'web') cancelDrag();
        }}
      >
        {children}
        {drag?.active ? (
          <View
            ref={ghostRef}
            testID="drag-ghost"
            pointerEvents="none"
            style={[
              styles.ghost,
              { width: drag.width, height: drag.height },
              Platform.OS === 'web' && {
                transform: [{ translateX: ghostTransform.x }, { translateY: ghostTransform.y }],
              },
            ]}
          >
            <Text testID="drop-best" numberOfLines={1} style={styles.ghostMeta}>
              {ghostBestId}
            </Text>
            <Text numberOfLines={2} style={styles.ghostText}>
              {drag.name || 'Untitled'}
            </Text>
          </View>
        ) : null}
      </View>
    </DragContext.Provider>
  );
}

export function DropPreview({ id, children, style }: { id: string; children?: ReactNode; style?: object }) {
  const { getBestId, subscribeBestId } = useDragDrop();
  const [on, setOn] = useState(() => getBestId() === id);
  useEffect(() => {
    setOn(getBestId() === id);
    return subscribeBestId((best) => setOn(best === id));
  }, [getBestId, id, subscribeBestId]);
  return <View style={[style, on ? styles.preview : null]}>{children}</View>;
}

export { HOLD_DELAY } from './nativeHold';

const styles = StyleSheet.create({
  fill: { flex: 1 },
  ghost: {
    position: 'absolute',
    top: 0,
    left: 0,
    opacity: 0.55,
    backgroundColor: colors.card,
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 80,
  },
  ghostText: {
    color: colors.ink,
    fontSize: type.body,
    fontWeight: '600',
  },
  ghostMeta: {
    color: colors.muted,
    fontSize: 10,
  },
  preview: {
    backgroundColor: colors.dropPreview,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
    borderRadius: 6,
  },
});
