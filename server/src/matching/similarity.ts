/**
 * Path similarity between two rides.
 *
 * Both tracks are resampled every ~25 m. coverage(A→B) is the share of A's points lying within
 * `toleranceM` of some point of B. The similarity is min(coverage(A→B), coverage(B→A)): two rides
 * only score high when each one covers (almost) all of the other. That means a ride with a long
 * extension does not match, while a short detour (e.g. a road closure) does.
 */
import { haversineM, pathLengthM, type LatLng } from '../geo/geo.ts';

const M_PER_DEG = 111_320;

export interface MatchSettings {
  /** Max distance (m) for a point to count as "on" the other track. */
  toleranceM: number;
  /** Minimum similarity for two rides to be the same route. */
  threshold: number;
}

export const DEFAULT_MATCH_SETTINGS: MatchSettings = { toleranceM: 40, threshold: 0.9 };

/** Bump when the matching logic changes in a way that should trigger a rebuild. */
export const MATCHER_VERSION = 1;

export type Direction = 'forward' | 'reverse';

/** A track with a spatial hash, built once and reused across many comparisons. */
export interface PreparedTrack {
  lats: Float64Array;
  lngs: Float64Array;
  n: number;
  lengthM: number;
  isLoop: boolean;
  cellLat: number;
  cellLng: number;
  cosLat: number;
  index: Map<number, number[]>;
}

const LOOP_MAX_GAP_M = 500;

export function prepareTrack(line: readonly LatLng[], toleranceM: number): PreparedTrack {
  const n = line.length;
  const lats = new Float64Array(n);
  const lngs = new Float64Array(n);
  let latSum = 0;
  for (let i = 0; i < n; i++) {
    lats[i] = line[i]!.lat;
    lngs[i] = line[i]!.lng;
    latSum += line[i]!.lat;
  }
  const meanLat = n > 0 ? latSum / n : 0;
  const cosLat = Math.cos((meanLat * Math.PI) / 180);
  const cellLat = toleranceM / M_PER_DEG;
  const cellLng = toleranceM / (M_PER_DEG * cosLat);
  const index = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const key = cellKey(Math.floor(lats[i]! / cellLat), Math.floor(lngs[i]! / cellLng));
    const bucket = index.get(key);
    if (bucket) bucket.push(i);
    else index.set(key, [i]);
  }
  const first = line[0];
  const last = line[n - 1];
  return {
    lats,
    lngs,
    n,
    lengthM: pathLengthM(line),
    isLoop:
      !!first && !!last && haversineM(first.lat, first.lng, last.lat, last.lng) < LOOP_MAX_GAP_M,
    cellLat,
    cellLng,
    cosLat,
    index,
  };
}

function cellKey(row: number, col: number): number {
  return (row + 2_000_000) * 4_000_000 + (col + 2_000_000);
}

/** Index of the nearest point of `track` within `toleranceM`, or -1. */
function nearestWithin(track: PreparedTrack, lat: number, lng: number, toleranceM: number): number {
  const row = Math.floor(lat / track.cellLat);
  const col = Math.floor(lng / track.cellLng);
  const maxD2 = toleranceM * toleranceM;
  let best = -1;
  let bestD2 = maxD2;
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const bucket = track.index.get(cellKey(row + dr, col + dc));
      if (!bucket) continue;
      for (const j of bucket) {
        const dy = (track.lats[j]! - lat) * M_PER_DEG;
        const dx = (track.lngs[j]! - lng) * M_PER_DEG * track.cosLat;
        const d2 = dx * dx + dy * dy;
        if (d2 <= bestD2) {
          bestD2 = d2;
          best = j;
        }
      }
    }
  }
  return best;
}

/** For each point of `a`, the index of its nearest point on `b` within tolerance (-1 if none). */
export function matchPoints(a: PreparedTrack, b: PreparedTrack, toleranceM: number): Int32Array {
  const out = new Int32Array(a.n);
  for (let i = 0; i < a.n; i++) out[i] = nearestWithin(b, a.lats[i]!, a.lngs[i]!, toleranceM);
  return out;
}

function coverage(matches: Int32Array): number {
  if (matches.length === 0) return 0;
  let hit = 0;
  for (const m of matches) if (m >= 0) hit++;
  return hit / matches.length;
}

/**
 * Direction of `a` relative to `b`: majority vote over the steps between consecutive matched
 * points. For loops, steps wrap around so a loop started at a different point still reads forward.
 */
function directionOf(matches: Int32Array, b: PreparedTrack): Direction {
  let forward = 0;
  let backward = 0;
  let prev = -1;
  for (const m of matches) {
    if (m < 0) continue;
    if (prev >= 0 && m !== prev) {
      let step = m - prev;
      if (b.isLoop) {
        if (step > b.n / 2) step -= b.n;
        else if (step < -b.n / 2) step += b.n;
      }
      if (step > 0) forward++;
      else if (step < 0) backward++;
    }
    prev = m;
  }
  return backward > forward ? 'reverse' : 'forward';
}

export interface Comparison {
  score: number;
  coverageAB: number;
  coverageBA: number;
  /** Direction of A relative to B. */
  direction: Direction;
}

export function compareTracks(a: PreparedTrack, b: PreparedTrack, toleranceM: number): Comparison {
  const ab = matchPoints(a, b, toleranceM);
  const coverageAB = coverage(ab);
  // Cheap early exit: the score can't exceed coverage(A→B).
  if (coverageAB === 0) return { score: 0, coverageAB, coverageBA: 0, direction: 'forward' };
  const coverageBA = coverage(matchPoints(b, a, toleranceM));
  return {
    score: Math.min(coverageAB, coverageBA),
    coverageAB,
    coverageBA,
    direction: directionOf(ab, b),
  };
}

/** Cheap pre-filter: rides whose lengths differ this much can never be the same route. */
export function lengthsCompatible(aM: number, bM: number): boolean {
  const ratio = Math.min(aM, bM) / Math.max(aM, bM);
  return ratio >= 0.75;
}

export interface Deviation {
  /** Parts of the ride that leave the reference route (detours). */
  detours: LatLng[][];
  /** Parts of the reference route the ride did not cover. */
  skipped: LatLng[][];
  detourLengthM: number;
  skippedLengthM: number;
}

export function findDeviations(
  ride: readonly LatLng[],
  reference: readonly LatLng[],
  settings: MatchSettings = DEFAULT_MATCH_SETTINGS,
  minLengthM = 150
): Deviation {
  const a = prepareTrack(ride, settings.toleranceM);
  const b = prepareTrack(reference, settings.toleranceM);
  const detours = offTrackRuns(ride, matchPoints(a, b, settings.toleranceM), minLengthM);
  const skipped = offTrackRuns(reference, matchPoints(b, a, settings.toleranceM), minLengthM);
  return {
    detours,
    skipped,
    detourLengthM: detours.reduce((s, r) => s + pathLengthM(r), 0),
    skippedLengthM: skipped.reduce((s, r) => s + pathLengthM(r), 0),
  };
}

/** Contiguous unmatched runs, padded with the adjacent matched points so they connect visually. */
function offTrackRuns(
  line: readonly LatLng[],
  matches: Int32Array,
  minLengthM: number
): LatLng[][] {
  const runs: LatLng[][] = [];
  let i = 0;
  while (i < line.length) {
    if (matches[i]! >= 0) {
      i++;
      continue;
    }
    const start = i;
    while (i < line.length && matches[i]! < 0) i++;
    const run = line.slice(Math.max(0, start - 1), Math.min(line.length, i + 1));
    if (pathLengthM(run) >= minLengthM) runs.push(run.map((p) => ({ lat: p.lat, lng: p.lng })));
  }
  return runs;
}
