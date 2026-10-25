import { Encoder, Profile, type Mesg } from '@garmin/fitsdk';
import { zipSync } from 'fflate';
import type { TrackPoint } from '../../src/track/codec.ts';

const DEG_TO_SEMICIRCLES = 2 ** 31 / 180;

/** Builds a minimal but valid FIT activity file (file id, devices, records, session). */
export function buildFit(
  points: readonly TrackPoint[],
  opts: { sport?: string; subSport?: string; withSensors?: boolean } = {}
): Uint8Array {
  const start = new Date(points[0]?.time ?? Date.UTC(2025, 0, 1));
  const end = new Date(points[points.length - 1]?.time ?? start.getTime());
  const enc = new Encoder();
  // The SDK's message types are loose; plain records keep this helper readable.
  const write = (mesgNum: number | undefined, fields: Record<string, unknown>) =>
    enc.onMesg(mesgNum!, fields as Mesg);
  write(Profile.MesgNum.FILE_ID, {
    manufacturer: 'development',
    product: 1,
    timeCreated: start,
    type: 'activity',
    serialNumber: 1234,
  });
  write(Profile.MesgNum.DEVICE_INFO, {
    timestamp: start,
    deviceIndex: 'creator',
    manufacturer: 'development',
    product: 1,
    serialNumber: 1234,
  });
  if (opts.withSensors) {
    write(Profile.MesgNum.DEVICE_INFO, {
      timestamp: start,
      deviceIndex: 2,
      deviceType: 11,
      sourceType: 'antplus',
      manufacturer: 'quarq',
      serialNumber: 987654,
      antDeviceNumber: 4242,
    });
  }
  for (const p of points) {
    write(Profile.MesgNum.RECORD, {
      timestamp: new Date(p.time ?? start.getTime()),
      positionLat: Math.round(p.lat * DEG_TO_SEMICIRCLES),
      positionLong: Math.round(p.lng * DEG_TO_SEMICIRCLES),
      ...(p.ele !== null ? { altitude: p.ele } : {}),
    });
  }
  write(Profile.MesgNum.SESSION, {
    timestamp: end,
    startTime: start,
    totalElapsedTime: (end.getTime() - start.getTime()) / 1000,
    totalTimerTime: (end.getTime() - start.getTime()) / 1000 - 60,
    totalDistance: 12345,
    totalAscent: 123,
    sport: opts.sport ?? 'cycling',
    subSport: opts.subSport ?? 'generic',
  });
  return enc.close();
}

export function zipFit(fit: Uint8Array, activityId: number): Uint8Array {
  return zipSync({ [`${activityId}_ACTIVITY.fit`]: fit });
}
