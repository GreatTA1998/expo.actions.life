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
import {
  clipRectToWindow,
  edgeScrollDelta,
  pickBestZoneId,
  readWindowRect,
  windowToLayer,
  type ZoneHit,
} from './geometry';
import { createDragGesture } from './gesture';

export type DropTarget =
  | { kind: 'list'; parentID: string; index: number }
  | { kind: 'nest'; parentID: string; at: 'first' | 'last' }
  | { kind: 'cal'; iso: string; allDay?: boolean };

export type Rect = { x: number; y: number; width: number; height: number };

export type DragOrigin = 'list' | 'cal' | 'nested-cal';

export type DragSession = {
  id: string;
  name: string;
  origin: DragOrigin;
  active: boolean;
  pointerX: number;
  pointerY: number;
  x: number;
  y: number;
  width: number;
  height: number;
  offsetX: number;
  offsetY: number;
};

type Zone = {
  id: string;
  target: DropTarget;
  ref: RefObject<View | null>;
  ownerTaskId?: string;
  rect: Rect | null;
};

export type Scroller = {
  id: string;
  axis: 'x' | 'y';
  getViewport: () => Rect | null;
  getOffset: () => { x: number; y: number };
  scrollTo: (next: { x: number; y: number }) => void;
  setEnabled?: (enabled: boolean) => void;
};

type DragContextValue = {
  drag: DragSession | null;
  pointerLocked: boolean;
  bestId: string;
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
};

const DragContext = createContext<DragContextValue | null>(null);
const MOUSE_SLOP = 2;
const TOUCH_SLOP = 5;
const PROBE_H = 2;
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
  const [bestId, setBestId] = useState('');
  const [pointerLocked, setPointerLocked] = useState(false);
  const [ghostTransform, setGhostTransform] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
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
  const pendingMove = useRef<{ x: number; y: number } | null>(null);
  onDropRef.current = onDrop;
  dragRef.current = drag;
  bestRef.current = bestId;

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
    const local = windowToLayer(session.x, session.y, layerOrigin.current);
    if (Platform.OS === 'web') {
      setGhostTransform({ x: local.x, y: local.y });
    } else {
      ghostRef.current?.setNativeProps?.({
        style: {
          width: session.width,
          height: session.height,
          transform: [{ translateX: local.x }, { translateY: local.y }],
        },
      });
    }
  }, []);

  const refreshZones = useCallback(() => {
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

  const pickZone = useCallback((session: DragSession) => {
    const win = Dimensions.get('window');
    const probe = {
      left: session.x,
      top: session.y,
      right: session.x + Math.max(session.width, 8),
      bottom: session.y + PROBE_H,
    };
    const hits: ZoneHit[] = [];
    for (const [id, zone] of zones.current) {
      if (zone.ownerTaskId && zone.ownerTaskId === session.id) continue;
      const raw = zone.rect;
      if (!raw || raw.width <= 0 || raw.height <= 0) continue;
      const rect = clipRectToWindow(raw, win);
      if (!rect) continue;
      const left = Math.max(probe.left, rect.x);
      const top = Math.max(probe.top, rect.y);
      const right = Math.min(probe.right, rect.x + rect.width);
      const bottom = Math.min(probe.bottom, rect.y + rect.height);
      const area = Math.max(0, right - left) * Math.max(0, bottom - top);
      if (area <= 0) continue;
      hits.push({ id, area, left: rect.x, rect });
    }
    const best = pickBestZoneId(hits);
    if (best !== bestRef.current) {
      bestRef.current = best;
      setBestId(best);
    }
  }, []);

  const lockScrollers = useCallback((enabled: boolean) => {
    for (const scroller of scrollers.current.values()) {
      scroller.setEnabled?.(enabled);
    }
  }, []);

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
        refreshZones();
        pickZone(session);
      }
    },
    [gesture, lockScrollers, measureLayer, pickZone, publishDrag, refreshZones],
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
      refreshZones();
      pickZone(next);
      return token;
    },
    [gesture, lockScrollers, measureLayer, pickZone, publishDrag, refreshZones],
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
    // One React publish per frame keeps calendar live-preview in sync without
    // re-rendering every touch sample.
    setDrag(next);
    pickZone(next);
  }, [paintGhost, pickZone]);

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
            setBestId('');
            return;
          }
        } else {
          return;
        }
      }
      const current = dragRef.current;
      if (!current?.active) return;
      pendingMove.current = { x: pageX, y: pageY };
      // Keep dragRef in sync with the live pointer. paintGhost on web writes
      // ghostTransform from this session; useLayoutEffect(bestId) re-paints from
      // dragRef and must not regress to the last rAF position.
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
    [activateDrag, flushMove, lockScrollers, paintGhost],
  );

  const cancelDrag = useCallback(() => {
    gesture.cancel();
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
    }
    pendingMove.current = null;
    dragRef.current = null;
    bestRef.current = '';
    pendingActivate.current = false;
    lockScrollers(true);
    setPointerLocked(false);
    setDrag(null);
    setBestId('');
  }, [gesture, lockScrollers]);

  const endDrag = useCallback(() => {
    if (moveRaf.current) {
      cancelAnimationFrame(moveRaf.current);
      moveRaf.current = 0;
      flushMove();
    }
    const session = dragRef.current;
    const zoneId = bestRef.current;
    if (session?.active && zoneId) {
      const zone = zones.current.get(zoneId);
      if (zone) {
        onDropRef.current(
          session.id,
          session.origin,
          zone.target,
          { x: session.pointerX, y: session.y },
          zone.rect,
        );
      }
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
        refreshZones();
        pickZone(session);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [drag?.active, pickZone, refreshZones]);

  const value = useMemo<DragContextValue>(
    () => ({
      drag,
      pointerLocked,
      bestId,
      registerZone,
      registerScroller,
      armDrag,
      activateDrag,
      moveDrag,
      endDrag,
      cancelDrag,
      refreshZones,
    }),
    [
      activateDrag,
      armDrag,
      bestId,
      cancelDrag,
      drag,
      endDrag,
      moveDrag,
      pointerLocked,
      refreshZones,
      registerScroller,
      registerZone,
    ],
  );

  const nativeHolding = () => Platform.OS !== 'web' && (pendingActivate.current || !!dragRef.current?.active);

  // Native: setNativeProps only (no React transform). Web: ghostTransform state.
  // dragRef stays live with the pointer so this re-paint cannot regress web state.
  useLayoutEffect(() => {
    const session = dragRef.current;
    if (session?.active) paintGhost(session);
  }, [bestId, drag?.active, drag?.id, drag?.name, drag?.width, drag?.height, paintGhost]);

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
              {bestId}
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
  const { bestId } = useDragDrop();
  const on = bestId === id;
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
