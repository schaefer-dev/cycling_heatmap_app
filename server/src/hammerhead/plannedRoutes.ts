/**
 * Mirrors the planned routes of the Hammerhead library into `planned_routes` (name, distance,
 * gain, created date: the API offers no geometry). Routes that disappear from the library are
 * marked deleted, not removed, so labels the user accepted keep working.
 *
 * This only feeds the suggestion list (matching/plannedSuggestions.ts); it never names routes or
 * links anything by itself.
 */
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import { logger } from '../logger.ts';
import { MAX_PAGE_SIZE, type HammerheadApi, type HammerheadRouteSummary } from './client.ts';

export interface PlannedRouteRow {
  id: string;
  name: string | null;
  created_at: string | null;
  distance_m: number | null;
  gain_m: number | null;
  deleted_at: string | null;
  synced_at: string;
}

export interface PlannedRoutesStatus {
  count: number;
  synced_at: string | null;
  error: string | null;
}

export async function syncPlannedRoutes(
  db: DB,
  api: Pick<HammerheadApi, 'listRoutes'>
): Promise<{ total: number; added: number; deleted: number }> {
  const routes: HammerheadRouteSummary[] = [];
  try {
    for (let page = 1; ; page++) {
      const res = await api.listRoutes(page, MAX_PAGE_SIZE);
      routes.push(...(res.data ?? []));
      if ((res.data ?? []).length === 0 || page >= (res.totalPages ?? page)) break;
    }
  } catch (e) {
    setStatus(db, null, (e as Error).message);
    throw e;
  }

  const now = new Date().toISOString();
  const before = new Set(
    (stmt(db, `SELECT id FROM planned_routes`).all() as Array<{ id: string }>).map((r) => r.id)
  );
  const upsert = stmt(
    db,
    `INSERT INTO planned_routes (id, name, created_at, distance_m, gain_m, deleted_at, synced_at)
     VALUES (@id, @name, @createdAt, @distance, @gain, NULL, @now)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, created_at = excluded.created_at,
       distance_m = excluded.distance_m, gain_m = excluded.gain_m, deleted_at = NULL,
       synced_at = excluded.synced_at`
  );
  const result = db.transaction(() => {
    for (const r of routes) {
      upsert.run({
        id: r.id,
        name: r.name ?? null,
        createdAt: r.createdAt ?? null,
        distance: r.distance ?? null,
        gain: r.gain ?? null,
        now,
      });
    }
    const deleted = stmt(
      db,
      `UPDATE planned_routes SET deleted_at = ? WHERE synced_at < ? AND deleted_at IS NULL`
    ).run(now, now).changes;
    return { total: routes.length, added: routes.filter((r) => !before.has(r.id)).length, deleted };
  })();
  setStatus(db, now, null);
  logger.info(
    `Planned routes synced: ${result.total} in library, ${result.added} new, ${result.deleted} removed`
  );
  return result;
}

/** Stored on the (single) connected-account row; nothing to record when not connected. */
function setStatus(db: DB, syncedAt: string | null, error: string | null): void {
  stmt(
    db,
    `UPDATE hammerhead_auth SET routes_synced_at = COALESCE(?, routes_synced_at), routes_error = ?
     WHERE id = 1`
  ).run(syncedAt, error);
}

export function plannedRoutesStatus(db: DB): PlannedRoutesStatus {
  const count = (
    stmt(db, `SELECT COUNT(*) AS n FROM planned_routes WHERE deleted_at IS NULL`).get() as {
      n: number;
    }
  ).n;
  const row = stmt(
    db,
    `SELECT routes_synced_at, routes_error FROM hammerhead_auth WHERE id = 1`
  ).get() as { routes_synced_at: string | null; routes_error: string | null } | undefined;
  return { count, synced_at: row?.routes_synced_at ?? null, error: row?.routes_error ?? null };
}

export function listPlannedRoutes(db: DB): PlannedRouteRow[] {
  return stmt(db, `SELECT * FROM planned_routes`).all() as PlannedRouteRow[];
}
