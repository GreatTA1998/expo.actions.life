import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { Dimensions, Platform, StyleSheet, Text, View } from 'react-native';
import { colors, type } from '../../theme';
import type { TaskRecord } from '../../models/types';
import { clipRectToWindow, edgeScrollDelta, readWindowRect } from './geometry';

export type DropTarget =
  | { kind: 'list'; parentID: string; index: number }
  | { kind: 'nest'; parentID: string }
  | { kind: 'cal'; iso: string };

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
};

type DragContextValue = {
  drag: DragSession | null;
  bestId: string;
  registerZone: (zone: Omit<Zone, 'rect'>) => () => void;
  registerScroller: (scroller: Scroller) => () => void;
  armDrag: (
    task: TaskRecord,
    origin: DragOrigin,
    pageX: number,
    pageY: number,
    rect: Rect,
  ) => void;
  activateDrag: () => void;
  moveDrag: (pageX: number, pageY: number) => void;
  endDrag: () => void;
  cancelDrag: () => void;
  refreshZones: () => void;
};

const DragContext = createContext<DragContextValue | null>(null);
const HOLD_MS = 150;
const MOUSE_SLOP = 2;
const TOUCH_SLOP = 5;
const PROBE_H = 8;
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

export function DragDropProvider({ children, onDrop }: ProviderProps) {
  const [drag, setDrag] = useState<DragSession | null>(emptySession);
  const [bestId, setBestId] = useState('');
  const dragRef = useRef<DragSession | null>(null);
  const bestRef = useRef('');
  const zones = useRef(new Map<string, Zone>());
  const scrollers = useRef(new Map<string, Scroller>());
  const onDropRef = useRef(onDrop);
  onDropRef.current = onDrop;
  dragRef.current = drag;
  bestRef.current = bestId;

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
      left: session.pointerX - 4,
      top: session.pointerY - PROBE_H / 2,
      right: session.pointerX + 4,
      bottom: session.pointerY + PROBE_H / 2,
    };
    let best = '';
    let max = 0;
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
      if (area > max) {
        max = area;
        best = id;
      }
    }
    if (best !== bestRef.current) {
      bestRef.current = best;
      setBestId(best);
    }
  }, []);

  const armDrag = useCallback(
    (task: TaskRecord, origin: DragOrigin, pageX: number, pageY: number, rect: Rect) => {
      const session: DragSession = {
        id: task.id,
        name: task.name,
        origin,
        active: false,
        pointerX: pageX,
        pointerY: pageY,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        offsetX: pageX - rect.x,
        offsetY: pageY - rect.y,
      };
      dragRef.current = session;
      setDrag(session);
    },
    [],
  );

  const activateDrag = useCallback(() => {
    const session = dragRef.current;
    if (!session || session.active) return;
    const next = { ...session, active: true };
    dragRef.current = next;
    setDrag(next);
    refreshZones();
    pickZone(next);
  }, [pickZone, refreshZones]);

  const moveDrag = useCallback(
    (pageX: number, pageY: number) => {
      const session = dragRef.current;
      if (!session) return;
      if (!session.active) {
        const slop = Platform.OS === 'web' ? MOUSE_SLOP : TOUCH_SLOP;
        if (Math.hypot(pageX - session.pointerX, pageY - session.pointerY) > slop) {
          if (Platform.OS === 'web') activateDrag();
          else {
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
      const next: DragSession = {
        ...current,
        pointerX: pageX,
        pointerY: pageY,
        x: pageX - current.offsetX,
        y: pageY - current.offsetY,
      };
      dragRef.current = next;
      setDrag(next);
      pickZone(next);
    },
    [activateDrag, pickZone],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    bestRef.current = '';
    setDrag(null);
    setBestId('');
  }, []);

  const endDrag = useCallback(() => {
    const session = dragRef.current;
    const zoneId = bestRef.current;
    if (session?.active && zoneId) {
      const zone = zones.current.get(zoneId);
      if (zone) {
        onDropRef.current(
          session.id,
          session.origin,
          zone.target,
          { x: session.pointerX, y: session.pointerY },
          zone.rect,
        );
      }
    }
    cancelDrag();
  }, [cancelDrag]);

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
    const move = (event: PointerEvent) => {
      if (!dragRef.current) return;
      if (dragRef.current.active) event.preventDefault();
      moveDrag(event.clientX, event.clientY);
    };
    const up = () => {
      if (!dragRef.current) return;
      if (dragRef.current.active) endDrag();
      else cancelDrag();
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
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
      refreshZones,
      registerScroller,
      registerZone,
    ],
  );

  return (
    <DragContext.Provider value={value}>
      <View
        style={styles.fill}
        onMoveShouldSetResponderCapture={() => !!dragRef.current?.active}
        onResponderMove={(event) => moveDrag(event.nativeEvent.pageX, event.nativeEvent.pageY)}
        onResponderRelease={endDrag}
        onResponderTerminate={cancelDrag}
      >
        {children}
        {drag?.active ? (
          <View
            testID="drag-ghost"
            pointerEvents="none"
            style={[styles.ghost, { width: drag.width, height: drag.height, transform: [{ translateX: drag.x }, { translateY: drag.y }] }]}
          >
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

export const HOLD_DELAY = HOLD_MS;

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
  preview: {
    backgroundColor: colors.dropPreview,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.dropBorder,
    borderRadius: 6,
  },
});
