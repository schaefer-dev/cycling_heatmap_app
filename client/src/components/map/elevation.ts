import type { LatLngTuple } from '../../api';
import { approxDistanceM } from './mapUtils';

export interface ProfilePoint {
  /** Index into the ride's track (for the map marker). */
  index: number;
  distKm: number;
  ele: number;
}

/** Distance/elevation pairs along a track; points without elevation are skipped. */
export function elevationProfile(
  track: readonly LatLngTuple[],
  elevation: ReadonlyArray<number | null>
): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  let dist = 0;
  for (let i = 0; i < track.length; i++) {
    if (i > 0) dist += approxDistanceM(track[i - 1]!, track[i]!);
    const ele = elevation[i];
    if (ele != null && Number.isFinite(ele)) out.push({ index: i, distKm: dist / 1000, ele });
  }
  return out;
}

/** At most `max` evenly spaced points (always keeps the last one). */
export function downsample<T>(points: readonly T[], max: number): T[] {
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]!);
}

/** The point closest to `distKm` (points sorted by distance). */
export function pointAtDistance(
  points: readonly ProfilePoint[],
  distKm: number
): ProfilePoint | null {
  if (points.length === 0) return null;
  let lo = 0;
  let hi = points.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid]!.distKm < distKm) lo = mid + 1;
    else hi = mid;
  }
  const prev = points[lo - 1];
  return prev && distKm - prev.distKm < points[lo]!.distKm - distKm ? prev : points[lo]!;
}
