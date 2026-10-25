import { Decoder, Stream } from '@garmin/fitsdk';
import { unzipSync } from 'fflate';
import type { RideDevice } from '../domain.ts';
import type { TrackPoint } from '../track/codec.ts';
import { classifyActivityType } from './activityType.ts';
import { InvalidActivityFileError } from './gpx.ts';
import type { ParsedActivity } from './parsedActivity.ts';

const SEMICIRCLE_TO_DEG = 180 / 2 ** 31;

type Mesg = Record<string, unknown>;

/** Garmin's download endpoint returns a ZIP with the original FIT file inside. */
export function extractFitFromZip(zip: Uint8Array): Uint8Array {
  const entries = unzipSync(zip);
  const fit = Object.entries(entries).find(([name]) => name.toLowerCase().endsWith('.fit'));
  if (!fit) throw new InvalidActivityFileError('Archive does not contain a FIT file');
  return fit[1];
}

export function parseFit(bytes: Uint8Array): ParsedActivity {
  const stream = Stream.fromByteArray(Array.from(bytes));
  if (!Decoder.isFIT(stream)) throw new InvalidActivityFileError('Not a FIT file');
  const decoder = new Decoder(stream);
  const { messages, errors } = decoder.read();
  if (errors.length > 0 && !messages.recordMesgs?.length) {
    throw new InvalidActivityFileError(`Invalid FIT file: ${String(errors[0])}`);
  }

  const points: TrackPoint[] = [];
  for (const r of (messages.recordMesgs ?? []) as Mesg[]) {
    const lat = r.positionLat;
    const lng = r.positionLong;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    const alt = (r.enhancedAltitude ?? r.altitude) as number | undefined;
    const ts = r.timestamp instanceof Date ? r.timestamp.getTime() : null;
    points.push({
      lat: lat * SEMICIRCLE_TO_DEG,
      lng: lng * SEMICIRCLE_TO_DEG,
      ele: typeof alt === 'number' && Number.isFinite(alt) ? alt : null,
      time: ts,
    });
  }

  const session = ((messages.sessionMesgs ?? []) as Mesg[])[0] ?? {};
  const sport = [session.sport, session.subSport]
    .filter((s) => typeof s === 'string' && s !== 'generic')
    .join(' ');

  return {
    title: null,
    points,
    ...classifyActivityType(sport || null),
    distanceM: numberOrUndefined(session.totalDistance),
    elevationGainM: numberOrUndefined(session.totalAscent),
    durationS: numberOrUndefined(session.totalElapsedTime),
    movingTimeS: numberOrUndefined(session.totalTimerTime),
    devices: extractDevices((messages.deviceInfoMesgs ?? []) as Mesg[]),
  };
}

/**
 * Head unit and paired sensors (power meter, speed sensor, shifting...). Their serial/ANT ids are
 * kept so rides can later be attributed to a specific bike.
 */
function extractDevices(mesgs: Mesg[]): RideDevice[] {
  const seen = new Set<string>();
  const out: RideDevice[] = [];
  for (const m of mesgs) {
    const device: RideDevice = {
      deviceIndex: stringOrNull(m.deviceIndex),
      deviceType: stringOrNull(m.antplusDeviceType ?? m.bleDeviceType ?? m.deviceType),
      sourceType: stringOrNull(m.sourceType),
      manufacturer: stringOrNull(m.manufacturer),
      product: stringOrNull(m.garminProduct ?? m.product),
      productName: stringOrNull(m.productName),
      serialNumber: typeof m.serialNumber === 'number' ? m.serialNumber : null,
      antDeviceNumber: typeof m.antDeviceNumber === 'number' ? m.antDeviceNumber : null,
    };
    const key = JSON.stringify(device);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(device);
  }
  return out;
}

function numberOrUndefined(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function stringOrNull(v: unknown): string | null {
  return v === undefined || v === null ? null : String(v);
}
