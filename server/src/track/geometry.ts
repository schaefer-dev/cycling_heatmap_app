/**
 * Derived per-ride geometry: a uniformly resampled line (route matching, heatmap), a simplified
 * line (drawing) and the set of grid cells the ride passes through (spatial lookups).
 */
import {
  bboxOf,
  removeSpikes,
  resample,
  simplify,
  pathLengthM,
  type BBox,
  type LatLng,
} from '../geo/geo.ts';
import { cellsOfTrack } from '../geo/cells.ts';
import type { TrackPoint } from './codec.ts';

/** Bump when the computation changes; rides with an older version are recomputed on startup. */
export const GEOMETRY_VERSION = 1;
export const RESAMPLE_SPACING_M = 25;
export const DISPLAY_TOLERANCE_M = 8;

export interface RideGeometry {
  lengthM: number;
  bbox: BBox;
  start: LatLng;
  end: LatLng;
  resampled: LatLng[];
  display: LatLng[];
  cells: number[];
}

export function computeGeometry(points: readonly TrackPoint[]): RideGeometry {
  if (points.length === 0) throw new Error('Cannot compute geometry of an empty track');
  const clean = removeSpikes(points);
  const resampled = resample(clean, RESAMPLE_SPACING_M);
  return {
    lengthM: pathLengthM(clean),
    bbox: bboxOf(clean),
    start: { lat: clean[0]!.lat, lng: clean[0]!.lng },
    end: { lat: clean[clean.length - 1]!.lat, lng: clean[clean.length - 1]!.lng },
    resampled,
    display: simplify(clean, DISPLAY_TOLERANCE_M).map((p) => ({ lat: p.lat, lng: p.lng })),
    cells: cellsOfTrack(resampled),
  };
}
