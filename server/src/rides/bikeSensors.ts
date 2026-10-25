/**
 * Bike type from the sensors paired during a ride (power meter, speed sensor...): each bike has
 * its own. Garmin's activity type is still trusted over them (the gravel bike is ridden on roads
 * too); Hammerhead mostly reports a generic "RIDE", so there the sensors decide first.
 *
 * Rules are personal (ANT+ ids), so they live in data/bike-sensors.json, not in the code; see
 * bike-sensors.example.json. Without that file nothing is classified.
 */
import fs from 'node:fs';
import { z } from 'zod';
import { BIKE_TYPES, type BikeType, type Provider, type RideDevice } from '../domain.ts';
import { logger } from '../logger.ts';

export interface BikeSensorRule {
  bikeType: BikeType;
  /** "<bike> / <sensor>", for logs. */
  name: string;
  deviceType: string;
  manufacturer: string;
  antIds: readonly number[];
}

export interface BikeSensorConfig {
  rules: readonly BikeSensorRule[];
  /** Bike type when neither a sensor nor the activity type tells; null leaves rides unassigned. */
  defaultBikeType: BikeType | null;
}

export const NO_BIKE_SENSORS: BikeSensorConfig = { rules: [], defaultBikeType: null };

/**
 * ANT+ device number of a sensor. Garmin head units often record only the serial number, whose low
 * 16 bits are the ANT id for most sensors; the Karoo writes serials with those bits zeroed.
 */
export function sensorId(d: RideDevice): number | null {
  if (d.antDeviceNumber) return d.antDeviceNumber;
  const low = d.serialNumber !== null ? d.serialNumber & 0xffff : 0;
  return low || null;
}

const same = (a: string | null, b: string) => a !== null && a.toLowerCase() === b.toLowerCase();

/**
 * The bike whose sensors were paired. A sensor without any id still counts when exactly one rule
 * has its device type and manufacturer. Sensors of different bikes cancel each other out.
 */
export function classifyByDevices(
  devices: readonly RideDevice[],
  rules: readonly BikeSensorRule[]
): { bikeType: BikeType; rule: BikeSensorRule } | null {
  const matched: BikeSensorRule[] = [];
  for (const d of devices) {
    const candidates = rules.filter(
      (r) => same(d.deviceType, r.deviceType) && same(d.manufacturer, r.manufacturer)
    );
    const id = sensorId(d);
    const rule =
      id !== null
        ? candidates.find((r) => r.antIds.includes(id))
        : candidates.length === 1
          ? candidates[0]
          : undefined;
    if (rule) matched.push(rule);
  }
  if (matched.length === 0) return null;
  const types = new Set(matched.map((r) => r.bikeType));
  if (types.size > 1) {
    logger.warn(`Sensors of different bikes in one ride: ${matched.map((r) => r.name).join(', ')}`);
    return null;
  }
  return { bikeType: matched[0]!.bikeType, rule: matched[0]! };
}

const ACTIVITY_TYPE_FIRST: Record<Provider, boolean> = { garmin: true, hammerhead: false };

/**
 * Garmin: activity type, then sensors. Hammerhead: sensors, then activity type. Then the
 * configured default. `reason` names the sensor rule or what else decided.
 */
export function resolveBikeType(
  provider: Provider,
  devices: readonly RideDevice[] | undefined,
  activityBikeType: BikeType | null,
  config: BikeSensorConfig
): { bikeType: BikeType; reason: string } | null {
  const byActivity = activityBikeType && { bikeType: activityBikeType, reason: 'activity type' };
  if (byActivity && ACTIVITY_TYPE_FIRST[provider]) return byActivity;
  const bySensor = classifyByDevices(devices ?? [], config.rules);
  if (bySensor) return { bikeType: bySensor.bikeType, reason: bySensor.rule.name };
  if (byActivity) return byActivity;
  return config.defaultBikeType ? { bikeType: config.defaultBikeType, reason: 'default' } : null;
}

const fileSchema = z.object({
  default: z.enum(BIKE_TYPES).nullable().default(null),
  bikes: z.array(
    z.object({
      name: z.string(),
      bikeType: z.enum(BIKE_TYPES),
      sensors: z.array(
        z.object({
          name: z.string().optional(),
          deviceType: z.string().min(1),
          manufacturer: z.string().min(1),
          antIds: z.array(z.number().int().positive()).min(1),
        })
      ),
    })
  ),
});

export function loadBikeSensorConfig(file: string): BikeSensorConfig {
  if (!fs.existsSync(file)) return NO_BIKE_SENSORS;
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`${file}: invalid JSON (${(e as Error).message})`, { cause: e });
  }
  const parsed = fileSchema.safeParse(raw);
  if (!parsed.success) throw new Error(`${file}:\n${z.prettifyError(parsed.error)}`);
  return {
    defaultBikeType: parsed.data.default,
    rules: parsed.data.bikes.flatMap((bike) =>
      bike.sensors.map((s) => ({
        bikeType: bike.bikeType,
        name: `${bike.name} / ${s.name ?? `${s.manufacturer} ${s.deviceType}`}`,
        deviceType: s.deviceType,
        manufacturer: s.manufacturer,
        antIds: s.antIds,
      }))
    ),
  };
}
