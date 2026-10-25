/**
 * Synthetic rides for tests. Routes are described as waypoints in metres (x east, y north) around
 * an arbitrary origin, densified to GPS-like 5 m sampling, with seeded noise. No real locations.
 */
import type { LatLng } from '../../src/geo/geo.ts';
import type { TrackPoint } from '../../src/track/codec.ts';

export const ORIGIN = { lat: 47.5, lng: 9.5 };
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LNG = 111_320 * Math.cos((ORIGIN.lat * Math.PI) / 180);

export type XY = [number, number];

export function toLatLng([x, y]: XY): LatLng {
  return { lat: ORIGIN.lat + y / M_PER_DEG_LAT, lng: ORIGIN.lng + x / M_PER_DEG_LNG };
}

/** Deterministic PRNG (mulberry32) so noisy tracks are reproducible. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

export interface RideOptions {
  /** GPS noise standard deviation in metres. */
  noiseM?: number;
  seed?: number;
  stepM?: number;
  startMs?: number;
  speedMps?: number;
  ele?: (i: number) => number | null;
}

/** Densifies waypoints into a GPS-like track with timestamps and optional noise. */
export function ride(waypoints: XY[], opts: RideOptions = {}): TrackPoint[] {
  const { noiseM = 0, seed = 1, stepM = 5, startMs = Date.UTC(2025, 5, 1, 8), speedMps = 7 } = opts;
  const rand = rng(seed);
  // GPS error drifts slowly rather than jumping independently at every fix: AR(1) noise.
  const rho = 0.95;
  const innovation = Math.sqrt(1 - rho * rho) * noiseM;
  let nx = gaussian(rand) * noiseM;
  let ny = gaussian(rand) * noiseM;
  const out: TrackPoint[] = [];
  let travelled = 0;
  for (let w = 1; w < waypoints.length; w++) {
    const [x0, y0] = waypoints[w - 1]!;
    const [x1, y1] = waypoints[w]!;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.round(len / stepM));
    for (let s = w === 1 ? 0 : 1; s <= steps; s++) {
      const t = s / steps;
      nx = rho * nx + innovation * gaussian(rand);
      ny = rho * ny + innovation * gaussian(rand);
      const x = x0 + (x1 - x0) * t + nx;
      const y = y0 + (y1 - y0) * t + ny;
      const p = toLatLng([x, y]);
      const dist = travelled + len * t;
      out.push({
        ...p,
        ele: opts.ele ? opts.ele(out.length) : 300,
        time: startMs + Math.round((dist / speedMps) * 1000),
      });
    }
    travelled += len;
  }
  return out;
}

/** A ~20 km rectangular loop: 6 km east, 4 km north, back west, back south. */
export const LOOP: XY[] = [
  [0, 0],
  [6000, 0],
  [6000, 4000],
  [0, 4000],
  [0, 0],
];

export function reversed(waypoints: XY[]): XY[] {
  return [...waypoints].reverse();
}

/** Same loop, but started at its north-east corner. */
export const LOOP_SHIFTED_START: XY[] = [
  [6000, 4000],
  [0, 4000],
  [0, 0],
  [6000, 0],
  [6000, 4000],
];

/** LOOP with a ~1 km detour (500 m out and back around a closed road on the east leg). */
export const LOOP_WITH_DETOUR: XY[] = [
  [0, 0],
  [6000, 0],
  [6000, 1500],
  [6400, 1500],
  [6400, 2500],
  [6000, 2500],
  [6000, 4000],
  [0, 4000],
  [0, 0],
];

/** Shares only the southern/eastern part of LOOP, then takes a different way back. */
export const LOOP_PARTIAL: XY[] = [
  [0, 0],
  [6000, 0],
  [6000, 4000],
  [3000, 4000],
  [3000, 7000],
  [-1500, 7000],
  [-1500, 0],
  [0, 0],
];

/** LOOP plus a 6 km out-and-back extension to the east (~30% longer). */
export const LOOP_EXTENDED: XY[] = [
  [0, 0],
  [6000, 0],
  [9000, 0],
  [6000, 0],
  [6000, 4000],
  [0, 4000],
  [0, 0],
];

export function toGpx(
  points: readonly TrackPoint[],
  opts: { name?: string; type?: string } = {}
): string {
  const pts = points
    .map(
      (p) =>
        `<trkpt lat="${p.lat.toFixed(7)}" lon="${p.lng.toFixed(7)}">${p.ele !== null ? `<ele>${p.ele}</ele>` : ''}${
          p.time !== null ? `<time>${new Date(p.time).toISOString()}</time>` : ''
        }</trkpt>`
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test"><trk>${opts.name ? `<name>${opts.name}</name>` : ''}${
    opts.type ? `<type>${opts.type}</type>` : ''
  }<trkseg>${pts}</trkseg></trk></gpx>`;
}
