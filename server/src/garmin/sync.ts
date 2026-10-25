/**
 * Pulls rides from Garmin Connect into the archive.
 *
 * - incremental: newest first; stops after a page in which every activity is already known.
 * - backfill: walks the entire history (first run, or to retry gaps).
 *
 * Every activity seen gets a row in garmin_activities (imported / linked / skipped / failed), so
 * nothing is downloaded twice and one broken file never blocks the sync. Rides that were imported
 * earlier from GPX exports are *linked* (Garmin id + devices added; title, bike type and track kept)
 * instead of being imported a second time.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import { ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import type { RouteService } from '../matching/routeService.ts';
import { extractFitFromZip, parseFit } from '../parsers/fit.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import type { RideImporter } from '../rides/importService.ts';
import * as rides from '../rides/repo.ts';
import { decideGarminType } from './activityTypes.ts';
import {
  GarminAuthError,
  parseGarminGmt,
  type GarminActivitySummary,
  type GarminApi,
} from './client.ts';

export type SyncMode = 'incremental' | 'backfill';

export const PAGE_SIZE = 50;
export const MAX_ATTEMPTS = 3;
/** Window for recognising an existing (GPX-imported) ride as the same Garmin activity. */
export const LINK_TOLERANCE_S = 120;

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
    activityId: number;
    name: string | null;
    start: string;
    action: string;
    detail?: string;
  }>;
}

interface ActivityState {
  status: 'imported' | 'linked' | 'skipped' | 'failed';
  attempts: number;
}

export interface GarminSyncDeps {
  db: DB;
  api: GarminApi;
  importer: RideImporter;
  routes: RouteService;
  /** Raw FIT files are kept here (data/fit/<activityId>.fit) for reprocessing later. */
  fitDir: string;
}

export class GarminSync {
  #deps: GarminSyncDeps;
  #running: Promise<SyncSummary> | null = null;

  constructor(deps: GarminSyncDeps) {
    this.#deps = deps;
  }

  get isRunning(): boolean {
    return this.#running !== null;
  }

  /** Starts a run; rejects with ConflictError if one is already in progress. */
  run(opts: { mode?: SyncMode; dryRun?: boolean } = {}): Promise<SyncSummary> {
    if (this.#running) return Promise.reject(new ConflictError('A Garmin sync is already running'));
    const p = this.#run(opts.mode ?? 'incremental', opts.dryRun ?? false).finally(() => {
      this.#running = null;
    });
    this.#running = p;
    return p;
  }

  async #run(mode: SyncMode, dryRun: boolean): Promise<SyncSummary> {
    const { db, api, routes } = this.#deps;
    const summary: SyncSummary = {
      runId: null,
      mode,
      dryRun,
      imported: 0,
      linked: 0,
      skipped: 0,
      failed: 0,
      plan: [],
    };
    if (!dryRun) {
      summary.runId = Number(
        stmt(db, `INSERT INTO sync_runs (started_at, mode, status) VALUES (?, ?, 'running')`).run(
          new Date().toISOString(),
          mode
        ).lastInsertRowid
      );
    }
    logger.info(`Garmin sync started (${mode}${dryRun ? ', dry run' : ''})`);

    try {
      for (let start = 0; ; start += PAGE_SIZE) {
        const page = await api.listActivities(start, PAGE_SIZE);
        let sawNew = false;
        for (const activity of page) {
          if (this.#isSettled(activity.activityId)) continue;
          sawNew = true;
          await this.#process(activity, summary, dryRun);
        }
        if (page.length < PAGE_SIZE) break;
        if (mode === 'incremental' && !sawNew) break;
      }
      this.#finish(summary, null);
    } catch (e) {
      this.#finish(summary, e as Error);
      throw e;
    }

    if (!dryRun && summary.imported + summary.linked > 0) {
      await routes
        .nameRoutes()
        .catch((e: Error) => logger.warn(`Route naming failed: ${e.message}`));
    }
    logger.info(
      `Garmin sync finished: ${summary.imported} imported, ${summary.linked} linked, ${summary.skipped} skipped, ${summary.failed} failed`
    );
    return summary;
  }

  #state(activityId: number): ActivityState | undefined {
    return stmt(
      this.#deps.db,
      `SELECT status, attempts FROM garmin_activities WHERE activity_id = ?`
    ).get(activityId) as ActivityState | undefined;
  }

  #isSettled(activityId: number): boolean {
    const s = this.#state(activityId);
    return !!s && (s.status !== 'failed' || s.attempts >= MAX_ATTEMPTS);
  }

  #record(
    a: GarminActivitySummary,
    status: ActivityState['status'],
    reason: string | null,
    rideId: string | null
  ): void {
    stmt(
      this.#deps.db,
      `INSERT INTO garmin_activities (activity_id, type_key, name, start_time, status, reason, attempts, ride_id, updated_at)
       VALUES (@id, @type, @name, @start, @status, @reason, @attempts, @rideId, CURRENT_TIMESTAMP)
       ON CONFLICT(activity_id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
         attempts = garmin_activities.attempts + (CASE WHEN excluded.status = 'failed' THEN 1 ELSE 0 END),
         ride_id = excluded.ride_id, updated_at = CURRENT_TIMESTAMP`
    ).run({
      id: a.activityId,
      type: a.activityType?.typeKey ?? null,
      name: a.activityName,
      start: new Date(parseGarminGmt(a.startTimeGMT)).toISOString(),
      status,
      reason,
      attempts: status === 'failed' ? 1 : 0,
      rideId,
    });
  }

  async #process(a: GarminActivitySummary, summary: SyncSummary, dryRun: boolean): Promise<void> {
    const { db } = this.#deps;
    const decision = decideGarminType(a.activityType?.typeKey);
    const plan = (action: string, detail?: string) =>
      summary.plan.push({
        activityId: a.activityId,
        name: a.activityName,
        start: a.startTimeGMT,
        action,
        detail,
      });

    if (decision.action === 'skip') {
      summary.skipped++;
      if (dryRun) plan('skip', decision.reason);
      else this.#record(a, 'skipped', decision.reason, null);
      return;
    }

    try {
      const startMs = parseGarminGmt(a.startTimeGMT);
      const existing =
        rides.findByGarminId(db, a.activityId) ??
        rides.findByStartTime(db, startMs, LINK_TOLERANCE_S)[0];

      if (existing) {
        if (existing.garmin_activity_id !== null && existing.garmin_activity_id !== a.activityId) {
          summary.skipped++;
          const reason = `same start time as Garmin activity ${existing.garmin_activity_id}`;
          if (dryRun) plan('skip', reason);
          else this.#record(a, 'skipped', reason, null);
          return;
        }
        summary.linked++;
        if (dryRun) {
          plan('link', `existing ride "${existing.title ?? existing.id}"`);
          return;
        }
        const parsed = await this.#download(a.activityId);
        this.#link(existing, a, decision.bikeType, parsed);
        this.#record(a, 'linked', null, existing.id);
        return;
      }

      if (dryRun) {
        summary.imported++;
        plan('import', decision.bikeType ?? 'unassigned bike type');
        return;
      }
      const parsed = await this.#download(a.activityId);
      if (parsed.points.length < 2) {
        summary.skipped++;
        this.#record(a, 'skipped', 'no GPS data', null);
        return;
      }
      const result = this.#deps.importer.import(parsed, {
        source: 'garmin',
        bikeType: decision.bikeType,
        garminActivityId: a.activityId,
        title: a.activityName,
        activityType: a.activityType.typeKey,
      });
      if (result.status === 'duplicate') {
        this.#link(result.existing, a, decision.bikeType, parsed);
        summary.linked++;
        this.#record(a, 'linked', null, result.existing.id);
      } else {
        summary.imported++;
        this.#record(a, 'imported', null, result.ride.id);
      }
    } catch (e) {
      if (e instanceof GarminAuthError) throw e;
      summary.failed++;
      const message = (e as Error).message;
      logger.warn(`Garmin activity ${a.activityId} failed: ${message}`);
      if (!dryRun) this.#record(a, 'failed', message, null);
    }
  }

  async #download(activityId: number): Promise<ParsedActivity> {
    const zip = await this.#deps.api.downloadActivity(activityId);
    const fit = extractFitFromZip(zip);
    fs.mkdirSync(this.#deps.fitDir, { recursive: true });
    fs.writeFileSync(path.join(this.#deps.fitDir, `${activityId}.fit`), fit);
    return parseFit(fit);
  }

  /** Attaches Garmin metadata to an existing ride without touching title, track or user choices. */
  #link(
    ride: rides.RideRow,
    a: GarminActivitySummary,
    bikeType: rides.RideRow['bike_type'],
    parsed: ParsedActivity
  ): void {
    const db = this.#deps.db;
    db.transaction(() => {
      stmt(
        db,
        `UPDATE rides SET garmin_activity_id = ?, activity_type = COALESCE(activity_type, ?),
           duration_s = COALESCE(duration_s, ?), moving_time_s = COALESCE(moving_time_s, ?),
           bike_type = COALESCE(bike_type, ?),
           bike_type_source = CASE WHEN bike_type IS NULL AND ? IS NOT NULL THEN 'auto' ELSE bike_type_source END
         WHERE id = ?`
      ).run(
        a.activityId,
        a.activityType.typeKey,
        parsed.durationS ?? a.elapsedDuration ?? null,
        parsed.movingTimeS ?? a.movingDuration ?? null,
        bikeType,
        bikeType,
        ride.id
      );
      if (parsed.devices?.length) rides.saveDevices(db, ride.id, parsed.devices);
    })();
  }

  #finish(summary: SyncSummary, error: Error | null): void {
    if (summary.runId === null) return;
    stmt(
      this.#deps.db,
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
}

export interface SyncRunRow {
  id: number;
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

export function lastSyncRuns(db: DB, limit = 5): SyncRunRow[] {
  return stmt(db, `SELECT * FROM sync_runs ORDER BY id DESC LIMIT ?`).all(limit) as SyncRunRow[];
}

/** Marks runs left in 'running' by a crash/restart as failed. */
export function closeStaleRuns(db: DB): void {
  stmt(
    db,
    `UPDATE sync_runs SET status = 'error', error = 'interrupted (server restarted)', finished_at = ?
     WHERE status = 'running'`
  ).run(new Date().toISOString());
}
