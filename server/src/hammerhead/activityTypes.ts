/** Maps Hammerhead activity types onto Garmin type keys, so both share one import decision. */
import { decideGarminType, type TypeDecision } from '../garmin/activityTypes.ts';

const TO_GARMIN_TYPE: Record<string, string> = {
  RIDE: 'cycling', // generic: bike type stays unassigned
  GRAVEL: 'gravel_cycling',
  MOUNTAIN_BIKE: 'mountain_biking',
  EMOUNTAIN_BIKE: 'e_bike_mountain',
  EBIKE: 'e_bike_fitness',
  VELOMOBILE: 'recumbent_cycling',
};

/** Garmin-style type key stored in rides.activity_type; null for unknown types. */
export function hammerheadTypeKey(type: string | undefined): string | null {
  return TO_GARMIN_TYPE[(type ?? '').toUpperCase()] ?? null;
}

export function decideHammerheadType(type: string | undefined): TypeDecision {
  const key = hammerheadTypeKey(type);
  if (!key) return { action: 'skip', reason: `not a supported ride type (${type || 'unknown'})` };
  return decideGarminType(key);
}
