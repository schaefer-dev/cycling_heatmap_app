const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '../../data/cycling_archive.db');

// Ensure data directory exists
const fs = require('fs');
const dataDir = path.dirname(DB_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new Database(DB_PATH);

// Enable foreign keys
db.pragma('foreign_keys = ON');

// Initialize schema
function initializeDatabase() {
  db.exec(`
    -- Ride metadata
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

    -- GPS track points (full resolution)
    CREATE TABLE IF NOT EXISTS track_points (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL,
      elevation REAL,
      timestamp TEXT,
      point_index INTEGER
    );

    -- Simplified track for heatmap (reduced points)
    CREATE TABLE IF NOT EXISTS track_points_simplified (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
      lat REAL NOT NULL,
      lng REAL NOT NULL
    );

    -- Rated sections
    CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      ride_id TEXT REFERENCES rides(id) ON DELETE CASCADE,
      start_lat REAL NOT NULL,
      start_lng REAL NOT NULL,
      start_index INTEGER,
      end_lat REAL NOT NULL,
      end_lng REAL NOT NULL,
      end_index INTEGER,
      track_segment TEXT,
      rating TEXT CHECK(rating IN ('excellent', 'good', 'challenging', 'hard', 'unridable')),
      bike_type TEXT CHECK(bike_type IN ('road', 'gravel', 'mtb')),
      surface_tags TEXT,
      notes TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    -- Indexes for performance
    CREATE INDEX IF NOT EXISTS idx_track_points_ride ON track_points(ride_id);
    CREATE INDEX IF NOT EXISTS idx_track_simplified_ride ON track_points_simplified(ride_id);
    CREATE INDEX IF NOT EXISTS idx_sections_ride ON sections(ride_id);
    CREATE INDEX IF NOT EXISTS idx_sections_rating ON sections(rating);
    CREATE INDEX IF NOT EXISTS idx_sections_bike_type ON sections(bike_type);
    CREATE INDEX IF NOT EXISTS idx_rides_bike_type ON rides(bike_type);
    CREATE INDEX IF NOT EXISTS idx_rides_date ON rides(date);
  `);

  console.log('Database initialized at:', DB_PATH);
}

initializeDatabase();

// Migration: Add track_segment column if it doesn't exist
try {
  db.exec(`ALTER TABLE sections ADD COLUMN track_segment TEXT`);
  console.log('Migration: Added track_segment column to sections table');
} catch (e) {
  // Column already exists, ignore
}

// Migration: Add spatial index on track_points for efficient near-point queries
try {
  db.exec(`CREATE INDEX IF NOT EXISTS idx_track_points_lat_lng ON track_points(lat, lng)`);
  console.log('Migration: Added lat/lng index on track_points');
} catch (e) {
  // Index already exists, ignore
}

module.exports = db;
