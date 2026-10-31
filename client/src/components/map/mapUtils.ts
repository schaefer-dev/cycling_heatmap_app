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

export interface DirectionArrow {
  position: LatLngTuple;
  /** Compass bearing of travel in degrees (0 = north, 90 = east). */
  bearingDeg: number;
}

/** `count` arrows at evenly spaced distances along the line (never at its very ends). */
export function directionArrows(track: readonly LatLngTuple[], count: number): DirectionArrow[] {
  if (track.length < 2 || count < 1) return [];
  const cumulative = [0];
  for (let i = 1; i < track.length; i++) {
    cumulative.push(cumulative[i - 1]! + approxDistanceM(track[i - 1]!, track[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total === 0) return [];

  const arrows: DirectionArrow[] = [];
  let seg = 1;
  for (let k = 1; k <= count; k++) {
    const target = (total * k) / (count + 1);
    while (seg < track.length - 1 && cumulative[seg]! < target) seg++;
    const a = track[seg - 1]!;
    const b = track[seg]!;
    const len = cumulative[seg]! - cumulative[seg - 1]!;
    const t = len > 0 ? (target - cumulative[seg - 1]!) / len : 0;
    arrows.push({
      position: [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t],
      bearingDeg: bearing(a, b),
    });
  }
  return arrows;
}

function bearing(a: LatLngTuple, b: LatLngTuple): number {
  const dy = b[0] - a[0];
  const dx = (b[1] - a[1]) * Math.cos(((a[0] + b[0]) / 2) * (Math.PI / 180));
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
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
