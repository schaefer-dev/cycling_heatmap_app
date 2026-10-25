/** Bookkeeping shared by the provider syncs: one sync_runs row per run, per provider. */
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { Provider } from '../domain.ts';

export type SyncMode = 'incremental' | 'backfill';

/** Failed activities are retried on later runs until they failed this often. */
export const MAX_ATTEMPTS = 3;

export interface SyncSummary {
  runId: number | null;
  mode: SyncMode;
  dryRun: boolean;
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  /** Only filled for dry runs. */
  plan: Array<{
    activityId: number | string;
    name: string | null;
    start: string;
    action: string;
    detail?: string;
  }>;
}

export interface SyncRunRow {
  id: number;
  provider: Provider;
  started_at: string;
  finished_at: string | null;
  mode: SyncMode;
  status: 'running' | 'success' | 'error';
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  error: string | null;
}

export function newSummary(mode: SyncMode, dryRun: boolean): SyncSummary {
  return { runId: null, mode, dryRun, imported: 0, linked: 0, skipped: 0, failed: 0, plan: [] };
}

/** Records the start of a run (dry runs leave no trace). */
export function startRun(db: DB, provider: Provider, summary: SyncSummary): void {
  if (summary.dryRun) return;
  summary.runId = Number(
    stmt(
      db,
      `INSERT INTO sync_runs (provider, started_at, mode, status) VALUES (?, ?, ?, 'running')`
    ).run(provider, new Date().toISOString(), summary.mode).lastInsertRowid
  );
}

export function finishRun(db: DB, summary: SyncSummary, error: Error | null): void {
  if (summary.runId === null) return;
  stmt(
    db,
    `UPDATE sync_runs SET finished_at = ?, status = ?, imported = ?, linked = ?, skipped = ?, failed = ?, error = ?
     WHERE id = ?`
  ).run(
    new Date().toISOString(),
    error ? 'error' : 'success',
    summary.imported,
    summary.linked,
    summary.skipped,
    summary.failed,
    error?.message ?? null,
    summary.runId
  );
}

export function lastSyncRuns(db: DB, provider: Provider, limit = 5): SyncRunRow[] {
  return stmt(db, `SELECT * FROM sync_runs WHERE provider = ? ORDER BY id DESC LIMIT ?`).all(
    provider,
    limit
  ) as SyncRunRow[];
}

/** Marks runs left in 'running' by a crash/restart as failed. */
export function closeStaleRuns(db: DB): void {
  stmt(
    db,
    `UPDATE sync_runs SET status = 'error', error = 'interrupted (server restarted)', finished_at = ?
     WHERE status = 'running'`
  ).run(new Date().toISOString());
}
