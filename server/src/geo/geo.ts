/** Geometry primitives. All distances are in meters. */

export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_000;
const DEG = Math.PI / 180;

export function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function distanceM(a: LatLng, b: LatLng): number {
  return haversineM(a.lat, a.lng, b.lat, b.lng);
}

export function pathLengthM(points: readonly LatLng[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

/**
 * Local equirectangular projection around a reference latitude. Accurate to well under 1%
 * over the extent of a ride, which is all the matching needs.
 */
export interface Projection {
  x(lng: number): number;
  y(lat: number): number;
}

export function localProjection(refLat: number): Projection {
  const kx = EARTH_RADIUS_M * DEG * Math.cos(refLat * DEG);
  const ky = EARTH_RADIUS_M * DEG;
  return { x: (lng) => lng * kx, y: (lat) => lat * ky };
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

export function bboxOf(points: readonly LatLng[]): BBox {
  let minLat = Infinity;
  let minLng = Infinity;
  let maxLat = -Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  return { minLat, minLng, maxLat, maxLng };
}

/** True when the boxes overlap after growing `a` by `marginDeg` on each side. */
export function bboxesOverlap(a: BBox, b: BBox, marginDeg = 0): boolean {
  return (
    a.minLat - marginDeg <= b.maxLat &&
    a.maxLat + marginDeg >= b.minLat &&
    a.minLng - marginDeg <= b.maxLng &&
    a.maxLng + marginDeg >= b.minLng
  );
}

/**
 * Removes single-point GPS spikes: a point far from both neighbours while the neighbours are
 * close to each other (the track jumps out and straight back).
 */
export function removeSpikes<T extends LatLng>(points: readonly T[], minJumpM = 100): T[] {
  if (points.length < 3) return [...points];
  const out: T[] = [points[0]!];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1]!;
    const cur = points[i]!;
    const next = points[i + 1]!;
    const dIn = distanceM(prev, cur);
    const dOut = distanceM(cur, next);
    const isSpike = dIn > minJumpM && dOut > minJumpM && distanceM(prev, next) < 0.3 * (dIn + dOut);
    if (!isSpike) out.push(cur);
  }
  out.push(points[points.length - 1]!);
  return out;
}

/** Resamples a polyline to points spaced `spacingM` apart along the path (first and last kept). */
export function resample(points: readonly LatLng[], spacingM: number): LatLng[] {
  if (points.length === 0) return [];
  const first = points[0]!;
  const out: LatLng[] = [{ lat: first.lat, lng: first.lng }];
  let carry = 0; // distance travelled since the last emitted point
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const seg = distanceM(a, b);
    if (seg === 0) continue;
    let along = spacingM - carry;
    while (along <= seg) {
      const t = along / seg;
      out.push({ lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t });
      along += spacingM;
    }
    carry = seg - (along - spacingM);
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (out.length === 1 || distanceM(tail, last) > spacingM / 4) {
    out.push({ lat: last.lat, lng: last.lng });
  }
  return out;
}

/** Iterative Douglas-Peucker in projected meters (no recursion, no array copies). */
export function simplify<T extends LatLng>(points: readonly T[], toleranceM: number): T[] {
  const n = points.length;
  if (n <= 2) return [...points];
  const proj = localProjection(points[0]!.lat);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = proj.x(points[i]!.lng);
    ys[i] = proj.y(points[i]!.lat);
  }
  const keep = new Uint8Array(n);
  keep[0] = 1;
  keep[n - 1] = 1;
  const stack: Array<[number, number]> = [[0, n - 1]];
  const tol2 = toleranceM * toleranceM;
  while (stack.length > 0) {
    const [start, end] = stack.pop()!;
    let maxD2 = 0;
    let maxIdx = -1;
    for (let i = start + 1; i < end; i++) {
      const d2 = segmentDistanceSq(xs[i]!, ys[i]!, xs[start]!, ys[start]!, xs[end]!, ys[end]!);
      if (d2 > maxD2) {
        maxD2 = d2;
        maxIdx = i;
      }
    }
    if (maxIdx !== -1 && maxD2 > tol2) {
      keep[maxIdx] = 1;
      stack.push([start, maxIdx], [maxIdx, end]);
    }
  }
  const out: T[] = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[i]!);
  return out;
}

function segmentDistanceSq(
  px: number,
  py: number,
  ax: number,
  ay: number,
  bx: number,
  by: number
): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px;
  const cy = ay + t * dy - py;
  return cx * cx + cy * cy;
}

/**
 * Elevation gain with a hysteresis threshold, so sensor noise is not counted as climbing.
 */
export function elevationGainM(elevations: ReadonlyArray<number | null>, thresholdM = 3): number {
  let gain = 0;
  let ref: number | null = null;
  for (const e of elevations) {
    if (e === null || !Number.isFinite(e)) continue;
    if (ref === null) {
      ref = e;
    } else if (e - ref >= thresholdM) {
      gain += e - ref;
      ref = e;
    } else if (e < ref) {
      ref = e;
    }
  }
  return gain;
}
