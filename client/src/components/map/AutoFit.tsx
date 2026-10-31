import type L from 'leaflet';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { LatLngTuple } from '../../api';

/** Fits the map once per `fitKey` when its bounds are known. Returning to the overview doesn't refit. */
export function AutoFit({
  fitKey,
  bounds,
  options,
}: {
  fitKey: string;
  bounds: [LatLngTuple, LatLngTuple] | null;
  /** Defaults to 40 px padding on every side. */
  options?: L.FitBoundsOptions;
}) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);
  const lastOverviewKey = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds || lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    if (fitKey.startsWith('all:')) {
      if (lastOverviewKey.current === fitKey) return;
      lastOverviewKey.current = fitKey;
    }
    map.fitBounds(bounds, options ?? { padding: [40, 40] });
    // Options only apply to the next fit; changing them alone must not refit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fitKey, bounds]);
  return null;
}
