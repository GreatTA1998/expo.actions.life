import { windowToLayer } from './geometry';

type GhostSession = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type GhostNative = {
  setNativeProps?: (props: { style?: object }) => void;
};

/** Paint the ghost via setNativeProps — no React re-render of the forest. */
export function paintGhostNative(
  ghost: GhostNative | null,
  session: GhostSession,
  layerOrigin: { x: number; y: number },
): { x: number; y: number } {
  const local = windowToLayer(session.x, session.y, layerOrigin);
  ghost?.setNativeProps?.({
    style: {
      width: session.width,
      height: session.height,
      transform: [{ translateX: local.x }, { translateY: local.y }],
    },
  });
  return local;
}
