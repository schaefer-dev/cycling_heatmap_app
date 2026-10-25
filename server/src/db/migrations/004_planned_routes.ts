import type { Migration } from '../migrate.ts';

/**
 * Planned routes from the Hammerhead library (names only: the API offers no route geometry) and
 * the user's review decisions on suggested route-group ↔ planned-route pairs. Nothing here is
 * filled automatically except the library mirror; links exist only after an explicit decision.
 */
export const plannedRoutes: Migration = {
  version: 4,
  name: 'planned-routes',
  up(db) {
    db.exec(`
      CREATE TABLE planned_routes (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT,
        distance_m REAL,
        gain_m REAL,
        deleted_at TEXT,
        synced_at TEXT NOT NULL
      );

      CREATE TABLE planned_route_links (
        route_id TEXT NOT NULL REFERENCES routes(id) ON DELETE CASCADE,
        planned_route_id TEXT NOT NULL REFERENCES planned_routes(id) ON DELETE CASCADE,
        decision TEXT NOT NULL CHECK(decision IN ('accepted', 'rejected')),
        score REAL,
        decided_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (route_id, planned_route_id)
      );
      CREATE UNIQUE INDEX idx_planned_links_accepted ON planned_route_links(route_id)
        WHERE decision = 'accepted';
      CREATE INDEX idx_planned_links_planned ON planned_route_links(planned_route_id);

      ALTER TABLE hammerhead_auth ADD COLUMN routes_synced_at TEXT;
      ALTER TABLE hammerhead_auth ADD COLUMN routes_error TEXT;
    `);
  },
};
