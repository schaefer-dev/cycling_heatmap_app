import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { RideDevice } from '../src/domain.ts';
import {
  classifyByDevices,
  loadBikeSensorConfig,
  resolveBikeType,
  sensorId,
  type BikeSensorConfig,
} from '../src/rides/bikeSensors.ts';
import { reclassifyBikeTypes } from '../src/rides/reclassify.ts';
import { getRide, saveDevices } from '../src/rides/repo.ts';
import { testContext } from './helpers/context.ts';
import { LOOP, ride, toGpx } from './helpers/tracks.ts';
import { parseGpx } from '../src/parsers/gpx.ts';

function device(fields: Partial<RideDevice>): RideDevice {
  return {
    deviceIndex: '1',
    deviceType: 'bikePower',
    sourceType: 'antplus',
    manufacturer: null,
    product: null,
    productName: null,
    serialNumber: null,
    antDeviceNumber: null,
    ...fields,
  };
}

const CONFIG: BikeSensorConfig = {
  defaultBikeType: 'road',
  rules: [
    {
      bikeType: 'road',
      name: 'Road / power',
      deviceType: 'bikePower',
      manufacturer: 'faveroElectronics',
      antIds: [1111],
    },
    {
      bikeType: 'gravel',
      name: 'Gravel / speed',
      deviceType: 'bikeSpeed',
      manufacturer: 'garmin',
      antIds: [2222],
    },
    {
      bikeType: 'gravel',
      name: 'Gravel / power',
      deviceType: 'bikePower',
      manufacturer: 'saxonar',
      antIds: [3333, 1],
    },
    {
      bikeType: 'mtb',
      name: 'MTB / speed',
      deviceType: 'bikeSpeed',
      manufacturer: 'garmin',
      antIds: [4444],
    },
  ],
};

const classify = (devices: RideDevice[]) => classifyByDevices(devices, CONFIG.rules)?.bikeType;

describe('sensorId', () => {
  it('uses the ANT id, else the low 16 bits of the serial number', () => {
    expect(sensorId(device({ antDeviceNumber: 5000, serialNumber: 999 }))).toBe(5000);
    expect(sensorId(device({ serialNumber: 0x10000 + 5000 }))).toBe(5000);
    expect(sensorId(device({ serialNumber: 0x12340000 }))).toBeNull(); // Karoo: low bits zeroed
    expect(sensorId(device({}))).toBeNull();
  });
});

describe('classifyByDevices', () => {
  it('matches type, manufacturer (any case) and id', () => {
    expect(classify([device({ manufacturer: 'saxonar', antDeviceNumber: 3333 })])).toBe('gravel');
    expect(classify([device({ manufacturer: 'SAXONAR', antDeviceNumber: 1 })])).toBe('gravel');
    expect(
      classify([device({ deviceType: 'bikeSpeed', manufacturer: 'garmin', serialNumber: 4444 })])
    ).toBe('mtb');
  });

  it('ignores other sensors and unknown ids', () => {
    expect(classify([device({ deviceType: 'heartRate', manufacturer: 'garmin' })])).toBeUndefined();
    expect(classify([device({ manufacturer: 'saxonar', antDeviceNumber: 9 })])).toBeUndefined();
    expect(
      classify([
        device({ deviceType: 'bikeSpeed', manufacturer: 'saxonar', antDeviceNumber: 3333 }),
      ])
    ).toBeUndefined();
  });

  it('matches a sensor without id only when one rule has its type and manufacturer', () => {
    expect(classify([device({ manufacturer: 'saxonar' })])).toBe('gravel');
    // Two bikes have a Garmin speed sensor: no id, no decision.
    expect(classify([device({ deviceType: 'bikeSpeed', manufacturer: 'garmin' })])).toBeUndefined();
  });

  it('decides nothing when sensors of different bikes were paired', () => {
    expect(
      classify([
        device({ manufacturer: 'faveroElectronics', antDeviceNumber: 1111 }),
        device({ deviceType: 'bikeSpeed', manufacturer: 'garmin', antDeviceNumber: 4444 }),
      ])
    ).toBeUndefined();
    expect(
      classify([
        device({ manufacturer: 'saxonar', antDeviceNumber: 3333 }),
        device({ deviceType: 'bikeSpeed', manufacturer: 'garmin', antDeviceNumber: 2222 }),
      ])
    ).toBe('gravel');
  });
});

describe('resolveBikeType', () => {
  const gravelPower = [device({ manufacturer: 'saxonar', antDeviceNumber: 3333 })];

  const type = (...args: Parameters<typeof resolveBikeType>) => resolveBikeType(...args)?.bikeType;

  it('Garmin: trusts the activity type, sensors only decide generic rides', () => {
    expect(resolveBikeType('garmin', gravelPower, 'road', CONFIG)).toEqual({
      bikeType: 'road',
      reason: 'activity type',
    });
    expect(resolveBikeType('garmin', gravelPower, null, CONFIG)).toEqual({
      bikeType: 'gravel',
      reason: 'Gravel / power',
    });
    expect(type('garmin', undefined, null, CONFIG)).toBe('road');
  });

  it('Hammerhead: prefers sensors, then the activity type, then the default', () => {
    expect(type('hammerhead', gravelPower, 'mtb', CONFIG)).toBe('gravel');
    expect(type('hammerhead', [], 'mtb', CONFIG)).toBe('mtb');
    expect(resolveBikeType('hammerhead', undefined, null, CONFIG)).toEqual({
      bikeType: 'road',
      reason: 'default',
    });
  });

  it('changes nothing without rules', () => {
    const none: BikeSensorConfig = { rules: [], defaultBikeType: null };
    expect(resolveBikeType('hammerhead', gravelPower, null, none)).toBeNull();
    expect(type('hammerhead', gravelPower, 'road', none)).toBe('road');
  });
});

describe('loadBikeSensorConfig', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });
  const file = (content: string) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bikes-'));
    dirs.push(dir);
    const p = path.join(dir, 'bike-sensors.json');
    fs.writeFileSync(p, content);
    return p;
  };

  it('returns no rules when the file is missing', () => {
    expect(loadBikeSensorConfig('/nonexistent/bike-sensors.json')).toEqual({
      rules: [],
      defaultBikeType: null,
    });
  });

  it('flattens bikes into rules', () => {
    const p = file(
      JSON.stringify({
        default: 'road',
        bikes: [
          {
            name: 'Gravel bike',
            bikeType: 'gravel',
            sensors: [{ deviceType: 'bikePower', manufacturer: 'saxonar', antIds: [5000, 1] }],
          },
        ],
      })
    );
    expect(loadBikeSensorConfig(p)).toEqual({
      defaultBikeType: 'road',
      rules: [
        {
          bikeType: 'gravel',
          name: 'Gravel bike / saxonar bikePower',
          deviceType: 'bikePower',
          manufacturer: 'saxonar',
          antIds: [5000, 1],
        },
      ],
    });
  });

  it('loads the committed example', () => {
    const example = path.resolve(import.meta.dirname, '../../bike-sensors.example.json');
    expect(loadBikeSensorConfig(example).rules.length).toBeGreaterThan(0);
  });

  it('rejects invalid files', () => {
    expect(() => loadBikeSensorConfig(file('{'))).toThrow(/invalid JSON/);
    expect(() =>
      loadBikeSensorConfig(
        file(JSON.stringify({ bikes: [{ name: 'x', bikeType: 'bmx', sensors: [] }] }))
      )
    ).toThrow(/bike-sensors\.json/);
  });
});

describe('reclassifyBikeTypes', () => {
  async function setup() {
    const ctx = await testContext();
    const T0 = Date.UTC(2026, 4, 1, 6);
    const add = (
      day: number,
      source: 'garmin' | 'hammerhead' | 'gpx',
      activityType: string | null
    ) => {
      const parsed = parseGpx(toGpx(ride(LOOP, { seed: day, startMs: T0 + day * 86_400_000 })));
      const res = ctx.importer.import(parsed, {
        source,
        bikeType: activityType === 'road_biking' ? 'road' : null,
        activityType,
      });
      if (res.status !== 'imported') throw new Error('not imported');
      return res.ride.id;
    };
    return { ctx, add };
  }

  it('re-derives synced rides, keeps user choices and uploads, and writes only with apply', async () => {
    const { ctx, add } = await setup();
    const garminRoad = add(0, 'garmin', 'road_biking');
    const unassigned = add(1, 'garmin', 'cycling');
    const userChoice = add(2, 'garmin', 'cycling');
    const upload = add(3, 'gpx', 'cycling');
    const karoo = add(4, 'hammerhead', 'cycling');
    const gravelPower = [device({ manufacturer: 'saxonar', serialNumber: 3333 })];
    for (const id of [garminRoad, userChoice, upload, karoo]) saveDevices(ctx.db, id, gravelPower);
    ctx.db
      .prepare(`UPDATE rides SET bike_type = 'mtb', bike_type_source = 'user' WHERE id = ?`)
      .run(userChoice);

    const dry = reclassifyBikeTypes(ctx.db, CONFIG, { apply: false });
    expect(dry.checked).toBe(3);
    // The Garmin road ride keeps its activity type despite the gravel power meter.
    expect(dry.changes.map((c) => [c.rideId, c.from, c.to, c.reason])).toEqual([
      [unassigned, null, 'road', 'default'],
      [karoo, null, 'gravel', 'Gravel / power'],
    ]);
    expect(getRide(ctx.db, karoo)?.bike_type).toBeNull();

    reclassifyBikeTypes(ctx.db, CONFIG, { apply: true });
    expect(getRide(ctx.db, karoo)).toMatchObject({ bike_type: 'gravel', bike_type_source: 'auto' });
    expect(getRide(ctx.db, garminRoad)?.bike_type).toBe('road');
    expect(getRide(ctx.db, unassigned)?.bike_type).toBe('road');
    expect(getRide(ctx.db, userChoice)?.bike_type).toBe('mtb');
    expect(getRide(ctx.db, upload)?.bike_type).toBeNull();
    expect(reclassifyBikeTypes(ctx.db, CONFIG, { apply: false }).changes).toEqual([]);
  });
});
