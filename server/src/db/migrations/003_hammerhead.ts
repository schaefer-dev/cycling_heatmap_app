import type { Migration } from '../migrate.ts';

/**
 * Hammerhead (Karoo) sync: ride link column, per-activity bookkeeping (like garmin_activities),
 * the OAuth tokens of the connected account, and a provider column for sync runs.
 */
export const hammerhead: Migration = {
  version: 3,
  name: 'hammerhead',
  up(db) {
    db.exec(`
      ALTER TABLE rides ADD COLUMN hammerhead_activity_id TEXT;
      CREATE UNIQUE INDEX idx_rides_hammerhead ON rides(hammerhead_activity_id)
        WHERE hammerhead_activity_id IS NOT NULL;

      CREATE TABLE hammerhead_activities (
        activity_id TEXT PRIMARY KEY,
        type_key TEXT,
        name TEXT,
        start_time TEXT,
        status TEXT NOT NULL CHECK(status IN ('imported', 'linked', 'skipped', 'failed')),
        reason TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        ride_id TEXT REFERENCES rides(id) ON DELETE SET NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE hammerhead_auth (
        id INTEGER PRIMARY KEY CHECK(id = 1),
        user_id TEXT,
        access_token TEXT NOT NULL,
        refresh_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        connected_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      ALTER TABLE sync_runs ADD COLUMN provider TEXT NOT NULL DEFAULT 'garmin';
      CREATE INDEX idx_sync_runs_provider ON sync_runs(provider, id);
    `);
  },
};
