import type { Migration } from '../migrate.ts';

/**
 * The schema as it existed before versioned migrations (user_version 0). Idempotent, so it is a
 * no-op on existing databases and creates the legacy layout on fresh ones; 002 then converts it.
 */
export const baseline: Migration = {
  version: 1,
  name: 'baseline',
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS rides (
        id TEXT PRIMARY KEY,
        title TEXT,
        date TEXT,
        bike_type TEXT CHECK(bike_type IN ('road', 'gravel', 'mtb')),
        distance_km REAL,
        elevation_gain_m REAL,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS track_points (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
        lat REAL NOT NULL,
        lng REAL NOT NULL,
        elevation REAL,
        timestamp TEXT,
        point_index INTEGER
      );
      CREATE TABLE IF NOT EXISTS track_points_simplified (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
        lat REAL NOT NULL,
        lng REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sections (
        id TEXT PRIMARY KEY,
        ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
        start_lat REAL NOT NULL,
        start_lng REAL NOT NULL,
        start_index INTEGER,
        end_lat REAL NOT NULL,
        end_lng REAL NOT NULL,
        end_index INTEGER,
        rating TEXT CHECK(rating IN ('excellent', 'good', 'challenging', 'hard', 'unridable')),
        bike_type TEXT CHECK(bike_type IN ('road', 'gravel', 'mtb')),
        surface_tags TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_track_points_ride ON track_points(ride_id);
      CREATE INDEX IF NOT EXISTS idx_track_simplified_ride ON track_points_simplified(ride_id);
      CREATE INDEX IF NOT EXISTS idx_sections_ride ON sections(ride_id);
      CREATE INDEX IF NOT EXISTS idx_sections_rating ON sections(rating);
      CREATE INDEX IF NOT EXISTS idx_sections_bike_type ON sections(bike_type);
      CREATE INDEX IF NOT EXISTS idx_rides_bike_type ON rides(bike_type);
      CREATE INDEX IF NOT EXISTS idx_rides_date ON rides(date);
    `);
    const sectionColumns = db.prepare(`PRAGMA table_info(sections)`).all() as Array<{
      name: string;
    }>;
    if (!sectionColumns.some((c) => c.name === 'track_segment')) {
      db.exec(`ALTER TABLE sections ADD COLUMN track_segment TEXT`);
    }
  },
};
