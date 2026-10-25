/** Classifies free-form activity type strings (GPX <type>, filenames, FIT sport names). */
import type { BikeType } from '../domain.ts';

const CYCLING_KEYWORDS = [
  'cycling',
  'biking',
  'bike',
  'ride',
  'bicycle',
  'road_biking',
  'road cycling',
  'mountain_biking',
  'mountain biking',
  'mtb',
  'gravel',
  'cyclocross',
  'e-bike',
  'ebike',
  'radfahren',
];
const ROAD_KEYWORDS = [
  'road_biking',
  'road cycling',
  'road biking',
  'road bike',
  'road',
  'rennrad',
];
const MTB_KEYWORDS = ['mountain_biking', 'mountain biking', 'mtb', 'mountain bike', 'mountain'];
const GRAVEL_KEYWORDS = ['gravel_cycling', 'gravel', 'cyclocross', 'gravel/cx'];

export interface ActivityClassification {
  activityType: string;
  isCycling: boolean;
  detectedBikeType: BikeType | null;
}

export function classifyActivityType(raw: string | null | undefined): ActivityClassification {
  const activityType = raw ? String(raw).toLowerCase().trim() : '';
  if (!activityType) return { activityType: 'unknown', isCycling: false, detectedBikeType: null };
  const has = (list: string[]) => list.some((k) => activityType.includes(k));
  const isCycling = has(CYCLING_KEYWORDS) || /\bcx\b/.test(activityType);
  let detectedBikeType: BikeType | null = null;
  if (isCycling) {
    if (has(ROAD_KEYWORDS)) detectedBikeType = 'road';
    else if (has(MTB_KEYWORDS)) detectedBikeType = 'mtb';
    else if (has(GRAVEL_KEYWORDS) || /\bcx\b/.test(activityType)) detectedBikeType = 'gravel';
  }
  return { activityType, isCycling, detectedBikeType };
}

/** Picks a type hint from a filename such as "gravel_ride_2024.gpx"; null when nothing matches. */
export function typeHintFromFilename(filename: string): string | null {
  const lower = filename.toLowerCase().replace(/[_-]+/g, ' ');
  const all = [...ROAD_KEYWORDS, ...MTB_KEYWORDS, ...GRAVEL_KEYWORDS, ...CYCLING_KEYWORDS];
  const hit = all.find((k) => lower.includes(k.replace(/_/g, ' ')));
  return hit ?? null;
}
