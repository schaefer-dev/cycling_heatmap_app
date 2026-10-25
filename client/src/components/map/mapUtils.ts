import type { LatLngTuple } from '../../api';

const M_PER_DEG = 111_320;

/** Approximate distance in metres (equirectangular; fine for click tolerances). */
export function approxDistanceM(a: LatLngTuple, b: LatLngTuple): number {
  const dy = (a[0] - b[0]) * M_PER_DEG;
  const dx = (a[1] - b[1]) * M_PER_DEG * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

/** Index of the track point closest to `p`, or -1 if none is within `maxDistanceM`. */
export function closestPointIndex(
  track: readonly LatLngTuple[],
  p: LatLngTuple,
  maxDistanceM: number
): number {
  let best = -1;
  let bestD = maxDistanceM;
  for (let i = 0; i < track.length; i++) {
    const d = approxDistanceM(track[i]!, p);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Bounding box of a line without spreading huge arrays into Math.min/max. */
export function lineBounds(track: readonly LatLngTuple[]): [LatLngTuple, LatLngTuple] | null {
  if (track.length === 0) return null;
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of track) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}
