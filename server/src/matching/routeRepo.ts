import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { Direction } from './similarity.ts';

export type NameSource = 'title' | 'geo' | 'fallback' | 'user';

export interface RouteRow {
  id: string;
  name: string | null;
  name_source: NameSource | null;
  reference_ride_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RouteSummary extends RouteRow {
  ride_count: number;
  first_ridden: string | null;
  last_ridden: string | null;
  avg_distance_km: number | null;
  avg_elevation_gain_m: number | null;
  bike_types: string | null;
  length_m: number | null;
}

export function createRoute(db: DB, id: string, referenceRideId: string): void {
  stmt(db, `INSERT INTO routes (id, reference_ride_id) VALUES (?, ?)`).run(id, referenceRideId);
}

export function getRoute(db: DB, id: string): RouteRow | undefined {
  return stmt(db, `SELECT * FROM routes WHERE id = ?`).get(id) as RouteRow | undefined;
}

export function listRouteRows(db: DB): RouteRow[] {
  return stmt(db, `SELECT * FROM routes ORDER BY created_at, id`).all() as RouteRow[];
}

const SUMMARY_SQL = `
  SELECT rt.*, COUNT(r.id) AS ride_count,
    MIN(COALESCE(r.start_time, r.date)) AS first_ridden,
    MAX(COALESCE(r.start_time, r.date)) AS last_ridden,
    AVG(r.distance_km) AS avg_distance_km,
    AVG(r.elevation_gain_m) AS avg_elevation_gain_m,
    GROUP_CONCAT(DISTINCT r.bike_type) AS bike_types,
    g.length_m AS length_m
  FROM routes rt
  JOIN rides r ON r.route_id = rt.id
  LEFT JOIN ride_geometry g ON g.ride_id = rt.reference_ride_id`;

export function listRouteSummaries(db: DB, opts: { bikeType?: string } = {}): RouteSummary[] {
  const where = opts.bikeType
    ? opts.bikeType === 'unassigned'
      ? `WHERE rt.id IN (SELECT route_id FROM rides WHERE bike_type IS NULL)`
      : `WHERE rt.id IN (SELECT route_id FROM rides WHERE bike_type = @bikeType)`
    : '';
  return db
    .prepare(`${SUMMARY_SQL} ${where} GROUP BY rt.id ORDER BY last_ridden DESC`)
    .all(opts.bikeType ? { bikeType: opts.bikeType } : {}) as RouteSummary[];
}

export function getRouteSummary(db: DB, id: string): RouteSummary | undefined {
  return stmt(db, `${SUMMARY_SQL} WHERE rt.id = ? GROUP BY rt.id`).get(id) as
    RouteSummary | undefined;
}

export function setRouteName(
  db: DB,
  id: string,
  name: string | null,
  source: NameSource | null
): void {
  stmt(
    db,
    `UPDATE routes SET name = ?, name_source = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(name, source, id);
}

export function isNameTaken(db: DB, name: string, exceptRouteId?: string): boolean {
  return !!stmt(db, `SELECT 1 FROM routes WHERE name = ? AND id IS NOT ?`).get(
    name,
    exceptRouteId ?? null
  );
}

export function setReference(db: DB, routeId: string, rideId: string): void {
  stmt(
    db,
    `UPDATE routes SET reference_ride_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(rideId, routeId);
}

export function assignRideToRoute(
  db: DB,
  rideId: string,
  routeId: string | null,
  match: { score: number; direction: Direction } | null,
  assignment: 'auto' | 'manual'
): void {
  stmt(
    db,
    `UPDATE rides SET route_id = ?, route_similarity = ?, route_direction = ?, route_assignment = ?
     WHERE id = ?`
  ).run(routeId, match?.score ?? null, match?.direction ?? null, assignment, rideId);
}

export function routeMemberIds(db: DB, routeId: string): string[] {
  return (
    stmt(db, `SELECT id FROM rides WHERE route_id = ? ORDER BY start_time, id`).all(
      routeId
    ) as Array<{
      id: string;
    }>
  ).map((r) => r.id);
}

export function memberTitles(db: DB, routeId: string) {
  return stmt(
    db,
    `SELECT title, COALESCE(start_time, date, created_at) AS t, bike_type FROM rides WHERE route_id = ?`
  ).all(routeId) as Array<{ title: string | null; t: string; bike_type: string | null }>;
}

/**
 * Routes whose reference ride shares at least `minShare` of the given cells. Any true match shares
 * nearly all cells, so this is a cheap and safe pre-filter.
 */
export function candidateRoutes(
  db: DB,
  cells: readonly number[],
  minShare = 0.5
): Array<{ routeId: string; referenceRideId: string }> {
  if (cells.length === 0) return [];
  return stmt(
    db,
    `SELECT rt.id AS routeId, rt.reference_ride_id AS referenceRideId
     FROM routes rt
     JOIN (
       SELECT ride_id, COUNT(*) AS shared FROM ride_cells
       WHERE cell IN (SELECT value FROM json_each(?))
       GROUP BY ride_id
     ) c ON c.ride_id = rt.reference_ride_id
     WHERE c.shared >= ?`
  ).all(JSON.stringify(cells), Math.ceil(cells.length * minShare)) as Array<{
    routeId: string;
    referenceRideId: string;
  }>;
}

export function rideCells(db: DB, rideId: string): number[] {
  return (
    stmt(db, `SELECT cell FROM ride_cells WHERE ride_id = ?`).all(rideId) as Array<{ cell: number }>
  ).map((r) => r.cell);
}

/** Removes routes without rides. Returns the number removed. */
export function deleteEmptyRoutes(db: DB): number {
  return stmt(
    db,
    `DELETE FROM routes WHERE NOT EXISTS (SELECT 1 FROM rides WHERE rides.route_id = routes.id)`
  ).run().changes;
}

export function deleteRoute(db: DB, id: string): void {
  stmt(db, `DELETE FROM routes WHERE id = ?`).run(id);
}

/** Routes that still need an automatic name or might get a better one. */
export function routesNeedingName(db: DB): RouteRow[] {
  return stmt(
    db,
    `SELECT * FROM routes WHERE name IS NULL OR name_source IN ('fallback', 'title', 'geo')`
  ).all() as RouteRow[];
}
