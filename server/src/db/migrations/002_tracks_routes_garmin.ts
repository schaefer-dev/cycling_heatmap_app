import type { Migration } from '../migrate.ts';
import { encodeTrack, type TrackPoint } from '../../track/codec.ts';

/**
 * - Moves GPS points from one-row-per-point tables into one compact blob per ride.
 * - Adds ride metadata (start time, Garmin link, route assignment).
 * - Adds routes, derived geometry/cell tables, Garmin sync bookkeeping and device info.
 *
 * Derived data (ride_geometry, ride_cells, route assignment) is NOT computed here: it depends on
 * algorithm versions and is (re)built by application code, see track/derived.ts.
 */
export const tracksRoutesGarmin: Migration = {
  version: 2,
  name: 'tracks-routes-garmin',
  vacuum: true,
  up(db) {
    db.exec(`
      CREATE TABLE routes (
        id TEXT PRIMARY KEY,
        name TEXT COLLATE NOCASE,
        name_source TEXT CHECK(name_source IN ('title', 'geo', 'fallback', 'user')),
        reference_ride_id TEXT REFERENCES rides(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE UNIQUE INDEX idx_routes_name ON routes(name) WHERE name IS NOT NULL;

      ALTER TABLE rides ADD COLUMN start_time TEXT;
      ALTER TABLE rides ADD COLUMN duration_s REAL;
      ALTER TABLE rides ADD COLUMN moving_time_s REAL;
      ALTER TABLE rides ADD COLUMN source TEXT NOT NULL DEFAULT 'gpx';
      ALTER TABLE rides ADD COLUMN activity_type TEXT;
      ALTER TABLE rides ADD COLUMN bike_type_source TEXT;
      ALTER TABLE rides ADD COLUMN garmin_activity_id INTEGER;
      ALTER TABLE rides ADD COLUMN route_id TEXT REFERENCES routes(id) ON DELETE SET NULL;
      ALTER TABLE rides ADD COLUMN route_similarity REAL;
      ALTER TABLE rides ADD COLUMN route_direction TEXT;
      ALTER TABLE rides ADD COLUMN route_assignment TEXT;
      CREATE UNIQUE INDEX idx_rides_garmin ON rides(garmin_activity_id)
        WHERE garmin_activity_id IS NOT NULL;
      CREATE INDEX idx_rides_start_time ON rides(start_time);
      CREATE INDEX idx_rides_route ON rides(route_id);

      CREATE TABLE ride_tracks (
        ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
        t0 INTEGER,
        point_count INTEGER NOT NULL,
        points BLOB NOT NULL
      );

      CREATE TABLE ride_geometry (
        ride_id TEXT PRIMARY KEY REFERENCES rides(id) ON DELETE CASCADE,
        version INTEGER NOT NULL,
        length_m REAL NOT NULL,
        min_lat REAL NOT NULL, min_lng REAL NOT NULL,
        max_lat REAL NOT NULL, max_lng REAL NOT NULL,
        start_lat REAL NOT NULL, start_lng REAL NOT NULL,
        end_lat REAL NOT NULL, end_lng REAL NOT NULL,
        resampled BLOB NOT NULL,
        display BLOB NOT NULL
      );

      CREATE TABLE ride_cells (
        cell INTEGER NOT NULL,
        ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
        PRIMARY KEY (cell, ride_id)
      ) WITHOUT ROWID;
      CREATE INDEX idx_ride_cells_ride ON ride_cells(ride_id);

      CREATE TABLE ride_devices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ride_id TEXT NOT NULL REFERENCES rides(id) ON DELETE CASCADE,
        device_index TEXT,
        device_type TEXT,
        source_type TEXT,
        manufacturer TEXT,
        product TEXT,
        product_name TEXT,
        serial_number INTEGER,
        ant_device_number INTEGER
      );
      CREATE INDEX idx_ride_devices_ride ON ride_devices(ride_id);
      CREATE INDEX idx_ride_devices_serial ON ride_devices(serial_number);

      CREATE TABLE garmin_activities (
        activity_id INTEGER PRIMARY KEY,
        type_key TEXT,
        name TEXT,
        start_time TEXT,
        status TEXT NOT NULL CHECK(status IN ('imported', 'linked', 'skipped', 'failed')),
        reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        ride_id TEXT REFERENCES rides(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE sync_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        mode TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('running', 'success', 'error')),
        imported INTEGER NOT NULL DEFAULT 0,
        linked INTEGER NOT NULL DEFAULT 0,
        skipped INTEGER NOT NULL DEFAULT 0,
        failed INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );

      CREATE TABLE geocode_cache (
        key TEXT PRIMARY KEY,
        place TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Move every ride's points into one blob, preserving point order (section indices rely on it).
    const rides = db.prepare(`SELECT id FROM rides`).all() as Array<{ id: string }>;
    const selectPoints = db.prepare(`
      SELECT lat, lng, elevation, timestamp FROM track_points
      WHERE ride_id = ? ORDER BY point_index, id
    `);
    const insertTrack = db.prepare(
      `INSERT INTO ride_tracks (ride_id, t0, point_count, points) VALUES (?, ?, ?, ?)`
    );
    const setStart = db.prepare(`UPDATE rides SET start_time = ?, duration_s = ? WHERE id = ?`);

    for (const { id } of rides) {
      const rows = selectPoints.all(id) as Array<{
        lat: number;
        lng: number;
        elevation: number | null;
        timestamp: string | null;
      }>;
      const points: TrackPoint[] = rows.map((r) => {
        const t = r.timestamp ? Date.parse(r.timestamp) : Number.NaN;
        return { lat: r.lat, lng: r.lng, ele: r.elevation, time: Number.isNaN(t) ? null : t };
      });
      const encoded = encodeTrack(points);
      insertTrack.run(id, encoded.t0, encoded.count, encoded.blob);
      const times = points.filter((p) => p.time !== null).map((p) => p.time!);
      if (times.length > 0) {
        const first = times[0]!;
        const last = times[times.length - 1]!;
        setStart.run(new Date(first).toISOString(), (last - first) / 1000, id);
      }
    }

    db.exec(`
      DROP TABLE track_points;
      DROP TABLE track_points_simplified;
    `);
  },
};
