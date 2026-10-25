/**
 * A fixed global grid of roughly 50 m cells (exact at ~50°N), packed into one integer so it can be
 * indexed in SQLite. Used for "which rides pass here" lookups and route-match candidate search.
 */
import type { LatLng } from './geo.ts';

export const CELL_LAT_DEG = 0.00045;
export const CELL_LNG_DEG = 0.0007;

const ROW_OFFSET = 2 ** 18;
const COL_OFFSET = 2 ** 19;
const COL_SPAN = 2 ** 20;

export function cellOf(lat: number, lng: number): number {
  const row = Math.floor(lat / CELL_LAT_DEG) + ROW_OFFSET;
  const col = Math.floor(lng / CELL_LNG_DEG) + COL_OFFSET;
  return row * COL_SPAN + col;
}

/** The cell plus its 8 neighbours. */
export function cellNeighbourhood(lat: number, lng: number): number[] {
  const center = cellOf(lat, lng);
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) out.push(center + dr * COL_SPAN + dc);
  }
  return out;
}

/** Distinct cells visited by a densely sampled track (spacing must be below the cell size). */
export function cellsOfTrack(points: readonly LatLng[]): number[] {
  const set = new Set<number>();
  for (const p of points) set.add(cellOf(p.lat, p.lng));
  return [...set];
}
