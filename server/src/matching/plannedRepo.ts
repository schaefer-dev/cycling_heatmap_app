/**
 * DB glue for planned-route suggestions: group statistics, the user's decisions, accepted labels.
 * Links are only written by the explicit accept / reject / unlink actions (RouteService).
 */
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import { listPlannedRoutes } from '../hammerhead/plannedRoutes.ts';
import type { Decisions, GroupStats, PlannedRoute } from './plannedSuggestions.ts';
import { pairKey } from './plannedSuggestions.ts';

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function groupStats(db: DB): GroupStats[] {
  const rows = stmt(
    db,
    `SELECT rt.id, rt.name, rt.name_source, r.distance_km, r.elevation_gain_m,
       COALESCE(r.start_time, r.date) AS t
     FROM routes rt JOIN rides r ON r.route_id = rt.id
     ORDER BY rt.id, t`
  ).all() as Array<{
    id: string;
    name: string | null;
    name_source: string | null;
    distance_km: number | null;
    elevation_gain_m: number | null;
    t: string | null;
  }>;
  const byRoute = new Map<string, typeof rows>();
  for (const r of rows) byRoute.set(r.id, [...(byRoute.get(r.id) ?? []), r]);
  const out: GroupStats[] = [];
  for (const [routeId, members] of byRoute) {
    const distance = median(
      members.map((m) => m.distance_km).filter((v): v is number => v !== null)
    );
    if (distance === null) continue;
    const times = members.map((m) => m.t).filter((t): t is string => t !== null);
    out.push({
      routeId,
      name: members[0]!.name,
      nameSource: members[0]!.name_source,
      rideCount: members.length,
      distanceKm: distance,
      elevationGainM: median(
        members.map((m) => m.elevation_gain_m).filter((v): v is number => v !== null)
      ),
      rideStarts: times.map((t) => Date.parse(t)).filter(Number.isFinite),
      firstRidden: times[0] ?? null,
      lastRidden: times[times.length - 1] ?? null,
    });
  }
  return out;
}

export function plannedForSuggestions(db: DB): PlannedRoute[] {
  return listPlannedRoutes(db).map((p) => ({
    id: p.id,
    name: p.name,
    createdAt: p.created_at,
    distanceM: p.distance_m,
    gainM: p.gain_m,
    deleted: p.deleted_at !== null,
  }));
}

export function decisions(db: DB): Decisions {
  const rows = stmt(
    db,
    `SELECT route_id, planned_route_id, decision FROM planned_route_links`
  ).all() as Array<{
    route_id: string;
    planned_route_id: string;
    decision: 'accepted' | 'rejected';
  }>;
  return {
    rejected: new Set(
      rows
        .filter((r) => r.decision === 'rejected')
        .map((r) => pairKey(r.route_id, r.planned_route_id))
    ),
    accepted: new Set(rows.filter((r) => r.decision === 'accepted').map((r) => r.route_id)),
  };
}

/** Route id → accepted planned route name. */
export function acceptedNames(db: DB): Map<string, string | null> {
  const rows = stmt(
    db,
    `SELECT l.route_id, p.name FROM planned_route_links l
     JOIN planned_routes p ON p.id = l.planned_route_id WHERE l.decision = 'accepted'`
  ).all() as Array<{ route_id: string; name: string | null }>;
  return new Map(rows.map((r) => [r.route_id, r.name]));
}

export function getPlannedRoute(db: DB, id: string) {
  return stmt(db, `SELECT id, name FROM planned_routes WHERE id = ?`).get(id) as
    { id: string; name: string | null } | undefined;
}

export function saveDecision(
  db: DB,
  routeId: string,
  plannedRouteId: string,
  decision: 'accepted' | 'rejected',
  score: number | null
): void {
  if (decision === 'accepted') {
    stmt(db, `DELETE FROM planned_route_links WHERE route_id = ? AND decision = 'accepted'`).run(
      routeId
    );
  }
  stmt(
    db,
    `INSERT INTO planned_route_links (route_id, planned_route_id, decision, score, decided_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(route_id, planned_route_id) DO UPDATE SET decision = excluded.decision,
       score = excluded.score, decided_at = excluded.decided_at`
  ).run(routeId, plannedRouteId, decision, score, new Date().toISOString());
}

export function removeAcceptedLink(db: DB, routeId: string): boolean {
  return (
    stmt(db, `DELETE FROM planned_route_links WHERE route_id = ? AND decision = 'accepted'`).run(
      routeId
    ).changes > 0
  );
}
