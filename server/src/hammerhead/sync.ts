/**
 * Pulls rides from the Hammerhead (Karoo) platform into the archive.
 *
 * - incremental: activities since a week before the newest one already seen (`startDate`).
 * - backfill (and the first run): the entire history.
 *
 * The Karoo uploads every ride to Garmin Connect as well, so most activities already exist here.
 * Unlike Garmin's summaries, Hammerhead's list has no reliable start time, so every new activity's
 * FIT file is downloaded and the importer's duplicate check (same id, start ±60 s, ≥50 % time
 * overlap) decides: an existing ride is *linked* (Hammerhead id added, gaps filled; title, track
 * and bike type kept), otherwise the ride is imported. Every activity seen gets a row in
 * hammerhead_activities, so nothing is downloaded twice and one broken file never blocks a sync.
 * The bike type comes from the paired sensors when a rule matches (bikeSensors.ts), otherwise from
 * the activity type.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/connection.ts';
import type { BikeType } from '../domain.ts';
import { stmt } from '../db/stmt.ts';
import { ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import type { RouteService } from '../matching/routeService.ts';
import { parseFit } from '../parsers/fit.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import { NO_BIKE_SENSORS, resolveBikeType, type BikeSensorConfig } from '../rides/bikeSensors.ts';
import type { Duplicate, RideImporter } from '../rides/importService.ts';
import {
  MAX_ATTEMPTS,
  finishRun,
  newSummary,
  startRun,
  type SyncMode,
  type SyncSummary,
} from '../sync/runs.ts';
import { decideHammerheadType, hammerheadTypeKey } from './activityTypes.ts';
import { syncPlannedRoutes } from './plannedRoutes.ts';
import {
  HammerheadAuthError,
  MAX_PAGE_SIZE,
  type HammerheadActivitySummary,
  type HammerheadApi,
  type TokenStore,
} from './client.ts';

/** Incremental runs re-list this far back, so late uploads and retries are not missed. */
export const INCREMENTAL_OVERLAP_DAYS = 7;

interface ActivityState {
  status: 'imported' | 'linked' | 'skipped' | 'failed';
  attempts: number;
}

export interface HammerheadSyncDeps {
  db: DB;
  api: HammerheadApi;
  tokens: TokenStore;
  importer: RideImporter;
  routes: RouteService;
  /** Raw FIT files are kept in <fitDir>/hammerhead/<activityId>.fit for reprocessing later. */
  fitDir: string;
  /** Sensor → bike rules; none by default. */
  bikeSensors?: BikeSensorConfig;
}

export class HammerheadSync {
  readonly name = 'Hammerhead';
  #deps: HammerheadSyncDeps;
  #running: Promise<SyncSummary> | null = null;

  constructor(deps: HammerheadSyncDeps) {
    this.#deps = deps;
  }

  get isRunning(): boolean {
    return this.#running !== null;
  }

  isConnected(): boolean {
    return this.#deps.tokens.load() !== null;
  }

  /** Scheduled runs wait until the account is connected. */
  isReady(): boolean {
    return this.isConnected();
  }

  isAuthError(e: unknown): boolean {
    return e instanceof HammerheadAuthError;
  }

  /** Mirrors the planned-route library (names for suggestions); see plannedRoutes.ts. */
  refreshPlannedRoutes() {
    return syncPlannedRoutes(this.#deps.db, this.#deps.api);
  }

  /** Starts a run; rejects with ConflictError if one is already in progress. */
  run(opts: { mode?: SyncMode; dryRun?: boolean } = {}): Promise<SyncSummary> {
    if (this.#running)
      return Promise.reject(new ConflictError('A Hammerhead sync is already running'));
    if (!this.isConnected())
      return Promise.reject(new HammerheadAuthError('Hammerhead is not connected'));
    const p = this.#run(opts.mode ?? 'incremental', opts.dryRun ?? false).finally(() => {
      this.#running = null;
    });
    this.#running = p;
    return p;
  }

  async #run(mode: SyncMode, dryRun: boolean): Promise<SyncSummary> {
    const { db, api, routes } = this.#deps;
    const summary = newSummary(mode, dryRun);
    startRun(db, 'hammerhead', summary);
    const startDate = mode === 'incremental' ? this.#incrementalStartDate() : undefined;
    logger.info(
      `Hammerhead sync started (${mode}${startDate ? ` since ${startDate}` : ''}${dryRun ? ', dry run' : ''})`
    );

    try {
      for (let page = 1; ; page++) {
        const res = await api.listActivities(page, MAX_PAGE_SIZE, startDate);
        const activities = res.data ?? [];
        for (const activity of activities) {
          if (this.#isSettled(activity.id)) continue;
          await this.#process(activity, summary, dryRun);
        }
        if (activities.length === 0 || page >= (res.totalPages ?? page)) break;
      }
      finishRun(db, summary, null);
    } catch (e) {
      finishRun(db, summary, e as Error);
      throw e;
    }

    if (!dryRun && summary.imported + summary.linked > 0) {
      await routes
        .nameRoutes()
        .catch((e: Error) => logger.warn(`Route naming failed: ${e.message}`));
    }
    // The planned-route library only feeds the suggestion list; its errors (e.g. a login without
    // the route:read permission) are recorded but never fail the ride sync.
    if (!dryRun) {
      await this.refreshPlannedRoutes().catch((e: Error) =>
        logger.warn(`Planned routes not synced: ${e.message}`)
      );
    }
    logger.info(
      `Hammerhead sync finished: ${summary.imported} imported, ${summary.linked} linked, ${summary.skipped} skipped, ${summary.failed} failed`
    );
    return summary;
  }

  /**
   * A week before the newest activity seen so far, but never after a failure that is still being
   * retried; undefined (= full history) on the first run.
   */
  #incrementalStartDate(): string | undefined {
    const row = stmt(
      this.#deps.db,
      `SELECT MAX(start_time) AS newest,
         MIN(CASE WHEN status = 'failed' AND attempts < ? THEN start_time END) AS retry
       FROM hammerhead_activities`
    ).get(MAX_ATTEMPTS) as { newest: string | null; retry: string | null };
    if (!row.newest) return undefined;
    const fromNewest = Date.parse(row.newest) - INCREMENTAL_OVERLAP_DAYS * 86_400_000;
    const from = row.retry ? Math.min(fromNewest, Date.parse(row.retry) - 86_400_000) : fromNewest;
    return new Date(from).toISOString().slice(0, 10);
  }

  #state(activityId: string): ActivityState | undefined {
    return stmt(
      this.#deps.db,
      `SELECT status, attempts FROM hammerhead_activities WHERE activity_id = ?`
    ).get(activityId) as ActivityState | undefined;
  }

  #isSettled(activityId: string): boolean {
    const s = this.#state(activityId);
    return !!s && (s.status !== 'failed' || s.attempts >= MAX_ATTEMPTS);
  }

  #record(
    a: HammerheadActivitySummary,
    fields: {
      status: ActivityState['status'];
      reason?: string | null;
      rideId?: string | null;
      typeKey?: string | null;
      startMs?: number | null;
    }
  ): void {
    const start = fields.startMs ?? Date.parse(a.createdAt);
    stmt(
      this.#deps.db,
      `INSERT INTO hammerhead_activities (activity_id, type_key, name, start_time, status, reason, attempts, ride_id, updated_at)
       VALUES (@id, @type, @name, @start, @status, @reason, @attempts, @rideId, CURRENT_TIMESTAMP)
       ON CONFLICT(activity_id) DO UPDATE SET type_key = COALESCE(excluded.type_key, hammerhead_activities.type_key),
         start_time = excluded.start_time, status = excluded.status, reason = excluded.reason,
         attempts = hammerhead_activities.attempts + (CASE WHEN excluded.status = 'failed' THEN 1 ELSE 0 END),
         ride_id = excluded.ride_id, updated_at = CURRENT_TIMESTAMP`
    ).run({
      id: a.id,
      type: fields.typeKey ?? null,
      name: a.name ?? null,
      start: Number.isFinite(start) ? new Date(start).toISOString() : null,
      status: fields.status,
      reason: fields.reason ?? null,
      attempts: fields.status === 'failed' ? 1 : 0,
      rideId: fields.rideId ?? null,
    });
  }

  async #process(
    a: HammerheadActivitySummary,
    summary: SyncSummary,
    dryRun: boolean
  ): Promise<void> {
    const plan = (action: string, detail?: string) =>
      summary.plan.push({ activityId: a.id, name: a.name, start: a.createdAt, action, detail });
    const skip = (reason: string, extra: { typeKey?: string | null; startMs?: number } = {}) => {
      summary.skipped++;
      if (dryRun) plan('skip', reason);
      else this.#record(a, { status: 'skipped', reason, ...extra });
    };

    try {
      const detail = await this.#deps.api.getActivity(a.id);
      const typeKey = hammerheadTypeKey(detail.activityType);
      const decision = decideHammerheadType(detail.activityType);
      if (decision.action === 'skip') return skip(decision.reason, { typeKey });

      const parsed = await this.#download(a.id, dryRun);
      const startMs = parsed.points.find((p) => p.time !== null)?.time ?? undefined;
      if (parsed.points.length < 2) return skip('no GPS data', { typeKey, startMs });
      const bikeType =
        resolveBikeType(
          'hammerhead',
          parsed.devices,
          decision.bikeType,
          this.#deps.bikeSensors ?? NO_BIKE_SENSORS
        )?.bikeType ?? null;

      const duplicate = this.#deps.importer.findDuplicate(parsed, { hammerhead: a.id });
      if (duplicate) {
        this.#link(a, duplicate, parsed, { typeKey, bikeType, startMs }, summary, dryRun);
        return;
      }

      if (dryRun) {
        summary.imported++;
        plan('import', bikeType ?? 'unassigned bike type');
        return;
      }
      const result = this.#deps.importer.import(parsed, {
        source: 'hammerhead',
        bikeType,
        hammerheadActivityId: a.id,
        title: a.name,
        activityType: typeKey,
      });
      if (result.status === 'duplicate') {
        const dup = { ride: result.existing, reason: result.reason };
        this.#link(a, dup, parsed, { typeKey, bikeType, startMs }, summary, false);
      } else {
        summary.imported++;
        this.#record(a, { status: 'imported', rideId: result.ride.id, typeKey, startMs });
      }
    } catch (e) {
      if (e instanceof HammerheadAuthError) throw e;
      summary.failed++;
      const message = (e as Error).message;
      logger.warn(`Hammerhead activity ${a.id} failed: ${message}`);
      if (!dryRun) this.#record(a, { status: 'failed', reason: message });
    }
  }

  /** Adds the Hammerhead id to the ride this activity duplicates (title, track, choices kept). */
  #link(
    a: HammerheadActivitySummary,
    duplicate: Duplicate,
    parsed: ParsedActivity,
    meta: { typeKey: string | null; bikeType: BikeType | null; startMs?: number },
    summary: SyncSummary,
    dryRun: boolean
  ): void {
    const { ride, reason } = duplicate;
    const label = `ride "${ride.title ?? ride.id}" (${ride.start_time ?? ride.date ?? 'no date'})`;
    const other = ride.hammerhead_activity_id;
    const conflict = other !== null && other !== a.id;
    const skipReason = `covered by ${label}, already linked to Hammerhead activity ${other}`;

    if (dryRun) {
      if (conflict) {
        summary.skipped++;
        summary.plan.push({
          activityId: a.id,
          name: a.name,
          start: a.createdAt,
          action: 'skip',
          detail: skipReason,
        });
      } else {
        summary.linked++;
        summary.plan.push({
          activityId: a.id,
          name: a.name,
          start: a.createdAt,
          action: 'link',
          detail: `${reason}: ${label}`,
        });
      }
      return;
    }

    const result = this.#deps.importer.linkExternal(ride, {
      provider: 'hammerhead',
      externalId: a.id,
      activityType: meta.typeKey,
      bikeType: meta.bikeType,
      durationS: parsed.durationS ?? null,
      movingTimeS: parsed.movingTimeS ?? null,
      devices: parsed.devices,
    });
    if (result.status === 'conflict') {
      summary.skipped++;
      this.#record(a, {
        status: 'skipped',
        reason: skipReason,
        typeKey: meta.typeKey,
        startMs: meta.startMs,
      });
      return;
    }
    summary.linked++;
    logger.debug(`Hammerhead activity ${a.id} linked to ${label} (${reason})`);
    this.#record(a, {
      status: 'linked',
      reason: `duplicate (${reason})`,
      rideId: ride.id,
      typeKey: meta.typeKey,
      startMs: meta.startMs,
    });
  }

  async #download(activityId: string, dryRun: boolean): Promise<ParsedActivity> {
    const fit = await this.#deps.api.downloadFit(activityId);
    if (!dryRun) {
      const dir = path.join(this.#deps.fitDir, 'hammerhead');
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, `${activityId.replace(/[^\w.-]/g, '_')}.fit`), fit);
    }
    return parseFit(fit);
  }
}
