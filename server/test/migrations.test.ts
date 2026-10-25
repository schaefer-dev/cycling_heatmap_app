import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDatabase } from '../src/db/connection.ts';
import { currentVersion, migrate } from '../src/db/migrate.ts';
import { baseline } from '../src/db/migrations/001_baseline.ts';
import { migrations } from '../src/db/migrations/index.ts';
import { RouteService } from '../src/matching/routeService.ts';
import { nullGeocoder } from '../src/matching/geocoder.ts';
import { ensureDerivedData } from '../src/rides/importService.ts';
import { loadTrack } from '../src/rides/repo.ts';
import { LOOP, ride } from './helpers/tracks.ts';

/** Builds a database exactly like the pre-refactor app produced (user_version 0). */
function legacyDb(file = ':memory:') {
  const db = openDatabase(file);
  baseline.up(db);
  const insertRide = db.prepare(
    `INSERT INTO rides (id, title, date, bike_type, distance_km, elevation_gain_m) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const insertPoint = db.prepare(
    `INSERT INTO track_points (ride_id, lat, lng, elevation, timestamp, point_index) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const points = ride(LOOP, { noiseM: 4, seed: 7, ele: (i) => (i === 0 ? 0 : 200 + (i % 10)) });
  for (const [id, offsetDays] of [
    ['ride-a', 0],
    ['ride-b', 7],
  ] as const) {
    insertRide.run(id, `Legacy ${id}`, '2025-06-01', 'gravel', 20.1, 150);
    // Insert out of order to prove point_index (not insertion order) defines the sequence.
    const order = points.map((_, i) => i).reverse();
    for (const i of order) {
      const p = points[i]!;
      const ts = new Date(p.time! + offsetDays * 86_400_000).toISOString();
      insertPoint.run(id, p.lat, p.lng, p.ele, ts, i);
    }
  }
  db.prepare(
    `INSERT INTO track_points_simplified (ride_id, lat, lng) VALUES ('ride-a', 1, 2)`
  ).run();
  db.prepare(
    `INSERT INTO sections (id, ride_id, start_lat, start_lng, start_index, end_lat, end_lng, end_index,
       track_segment, rating, bike_type, surface_tags)
     VALUES ('s1', 'ride-a', 1, 2, 0, 3, 4, 10, '[[1,2],[3,4]]', 'good', 'gravel', '["sand"]')`
  ).run();
  return { db, points };
}

describe('migrations', () => {
  it('converts a legacy database without losing rides, points or sections', async () => {
    const { db, points } = legacyDb();
    expect(currentVersion(db)).toBe(0);

    await migrate(db);
    expect(currentVersion(db)).toBe(migrations.length);

    const tables = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as Array<{
        name: string;
      }>
    ).map((t) => t.name);
    expect(tables).not.toContain('track_points');
    expect(tables).not.toContain('track_points_simplified');

    const track = loadTrack(db, 'ride-a')!;
    expect(track).toHaveLength(points.length);
    track.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(points[i]!.lat, 7);
      expect(p.lng).toBeCloseTo(points[i]!.lng, 7);
      expect(p.ele).toBeCloseTo(points[i]!.ele!, 3);
      expect(p.time).toBe(points[i]!.time);
    });
    expect(track[0]!.ele).toBe(0);

    const r = db.prepare(`SELECT * FROM rides WHERE id = 'ride-a'`).get() as Record<
      string,
      unknown
    >;
    expect(r).toMatchObject({
      title: 'Legacy ride-a',
      bike_type: 'gravel',
      source: 'gpx',
      start_time: new Date(points[0]!.time!).toISOString(),
    });
    expect(r.duration_s).toBeCloseTo((points.at(-1)!.time! - points[0]!.time!) / 1000);

    const s = db.prepare(`SELECT * FROM sections WHERE id = 's1'`).get() as Record<string, unknown>;
    expect(s).toMatchObject({
      ride_id: 'ride-a',
      start_index: 0,
      end_index: 10,
      track_segment: '[[1,2],[3,4]]',
    });

    // Derived data is then built by application code: both rides are the same loop → one route.
    const routes = new RouteService(db, nullGeocoder);
    expect(ensureDerivedData(db, routes)).toEqual({ geometry: 2, routed: 2 });
    const routeIds = db.prepare(`SELECT DISTINCT route_id FROM rides`).all();
    expect(routeIds).toHaveLength(1);
    expect(ensureDerivedData(db, routes)).toEqual({ geometry: 0, routed: 0 });
  });

  it('is a no-op when everything is applied, and works on a fresh database', async () => {
    const db = openDatabase(':memory:');
    expect(await migrate(db)).toEqual(migrations.map((m) => m.version));
    expect(await migrate(db)).toEqual([]);
  });

  it('writes a backup before migrating a file database and rolls back a failing migration', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cycling-migrate-'));
    try {
      const { db } = legacyDb(path.join(dir, 'archive.db'));
      const failing = {
        version: 99,
        name: 'boom',
        up: (d: typeof db) => {
          d.exec('CREATE TABLE half_done (x)');
          throw new Error('boom');
        },
      };
      await expect(
        migrate(db, { backupDir: path.join(dir, 'backups'), list: [...migrations, failing] })
      ).rejects.toThrow('boom');
      expect(fs.readdirSync(path.join(dir, 'backups'))).toHaveLength(1);
      expect(currentVersion(db)).toBe(migrations.length); // earlier migrations committed
      expect(
        db.prepare(`SELECT name FROM sqlite_master WHERE name = 'half_done'`).get()
      ).toBeUndefined();
      db.close();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
