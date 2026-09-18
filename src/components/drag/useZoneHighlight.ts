import { useEffect, useState } from 'react';
import { useDragDrop } from './DragDropContext';

/** Local highlight only — does not put bestId on the shared context value. */
export function useZoneHighlight(zoneId: string): boolean {
  const { getBestId, subscribeBestId } = useDragDrop();
  const [on, setOn] = useState(() => getBestId() === zoneId);
  useEffect(() => {
    setOn(getBestId() === zoneId);
    return subscribeBestId((id) => setOn(id === zoneId));
  }, [getBestId, subscribeBestId, zoneId]);
  return on;
}
