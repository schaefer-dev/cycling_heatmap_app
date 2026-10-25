import type { BikeType, RideDevice } from '../domain.ts';
import type { TrackPoint } from '../track/codec.ts';

/** Format-independent result of parsing a GPX or FIT file. */
export interface ParsedActivity {
  title: string | null;
  points: TrackPoint[];
  activityType: string;
  isCycling: boolean;
  detectedBikeType: BikeType | null;
  /** Values reported by the recording device; computed from points when absent. */
  distanceM?: number;
  elevationGainM?: number;
  durationS?: number;
  movingTimeS?: number;
  devices?: RideDevice[];
}
