/** Maps Garmin activity type keys to what the archive does with them. */
import type { BikeType } from '../domain.ts';

export type TypeDecision =
  { action: 'import'; bikeType: BikeType | null } | { action: 'skip'; reason: string };

const OUTDOOR_CYCLING: Record<string, BikeType | null> = {
  road_biking: 'road',
  gravel_cycling: 'gravel',
  cyclocross: 'gravel',
  mountain_biking: 'mtb',
  e_bike_mountain: 'mtb',
  enduro_mtb: 'mtb',
  downhill_biking: 'mtb',
  // No specific bike: imported as "unassigned" for manual (later: sensor-based) classification.
  cycling: null,
  e_bike_fitness: null,
  recumbent_cycling: null,
  track_cycling: null,
  bmx: null,
  hand_cycling: null,
};

const INDOOR_CYCLING = new Set([
  'indoor_cycling',
  'virtual_ride',
  'indoor_hand_cycling',
  'spinning',
]);

export function decideGarminType(typeKey: string | undefined): TypeDecision {
  const key = (typeKey ?? '').toLowerCase();
  if (key in OUTDOOR_CYCLING) return { action: 'import', bikeType: OUTDOOR_CYCLING[key] ?? null };
  if (INDOOR_CYCLING.has(key))
    return { action: 'skip', reason: `indoor ride without GPS (${key})` };
  return { action: 'skip', reason: `not a cycling activity (${key || 'unknown'})` };
}
