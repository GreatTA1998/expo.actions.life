/** Scroller registration shape used by DragDrop edge-scroll + scroll gate. */
export type Scroller = {
  id: string;
  axis: 'x' | 'y';
  getViewport: () => { x: number; y: number; width: number; height: number } | null;
  getOffset: () => { x: number; y: number };
  scrollTo: (next: { x: number; y: number }) => void;
  setEnabled?: (enabled: boolean) => void;
};

/**
 * Imperative scroll enable/disable for registered scrollers.
 * Used when a long-press arms or a duration resize starts — never from ordinary pans.
 */
export function setScrollersEnabled(scrollers: Iterable<Scroller>, enabled: boolean) {
  for (const scroller of scrollers) {
    scroller.setEnabled?.(enabled);
  }
}
