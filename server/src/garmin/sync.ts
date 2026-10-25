/**
 * Pulls rides from Garmin Connect into the archive.
 *
 * - incremental: newest first; stops after a page in which every activity is already known.
 * - backfill: walks the entire history (first run, or to retry gaps).
 *
 * Every activity seen gets a row in garmin_activities (imported / linked / skipped / failed), so
 * nothing is downloaded twice and one broken file never blocks the sync. Rides that were imported
 * earlier from GPX exports are *linked* (Garmin id + devices added; title, bike type and track kept)
 * instead of being imported a second time. The bike type comes from the activity type; only generic
 * "cycling" rides are classified by their paired sensors (bikeSensors.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { BikeType } from '../domain.ts';
import { ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import type { RouteService } from '../matching/routeService.ts';
import { extractFitFromZip, parseFit } from '../parsers/fit.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import { NO_BIKE_SENSORS, resolveBikeType, type BikeSensorConfig } from '../rides/bikeSensors.ts';
import type { RideImporter } from '../rides/importService.ts';
import * as rides from '../rides/repo.ts';
import {
  MAX_ATTEMPTS,
  finishRun,
  newSummary,
  startRun,
  type SyncMode,
  type SyncSummary,
} from '../sync/runs.ts';
import { decideGarminType } from './activityTypes.ts';
import {
  GarminAuthError,
  parseGarminGmt,
  type GarminActivitySummary,
  type GarminApi,
} from './client.ts';

export const PAGE_SIZE = 50;
/** Window for recognising an existing (GPX-imported) ride as the same Garmin activity. */
export const LINK_TOLERANCE_S = 120;

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
  /** Sensor → bike rules; none by default. */
  bikeSensors?: BikeSensorConfig;
}

export class GarminSync {
  readonly name = 'Garmin';
  #deps: GarminSyncDeps;
  #running: Promise<SyncSummary> | null = null;

  constructor(deps: GarminSyncDeps) {
    this.#deps = deps;
  }

  get isRunning(): boolean {
    return this.#running !== null;
  }

  isAuthError(e: unknown): boolean {
    return e instanceof GarminAuthError;
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
    const summary = newSummary(mode, dryRun);
    startRun(db, 'garmin', summary);
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
        if (dryRun) {
          summary.linked++;
          plan('link', `existing ride "${existing.title ?? existing.id}"`);
          return;
        }
        const parsed = await this.#download(a.activityId);
        this.#link(existing, a, this.#bikeType(parsed, decision.bikeType), parsed, summary);
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
      const bikeType = this.#bikeType(parsed, decision.bikeType);
      const result = this.#deps.importer.import(parsed, {
        source: 'garmin',
        bikeType,
        garminActivityId: a.activityId,
        title: a.activityName,
        activityType: a.activityType.typeKey,
      });
      if (result.status === 'duplicate') {
        this.#link(result.existing, a, bikeType, parsed, summary);
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

  #bikeType(parsed: ParsedActivity, fromActivityType: BikeType | null): BikeType | null {
    const config = this.#deps.bikeSensors ?? NO_BIKE_SENSORS;
    return resolveBikeType('garmin', parsed.devices, fromActivityType, config)?.bikeType ?? null;
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
    parsed: ParsedActivity,
    summary: SyncSummary
  ): void {
    const result = this.#deps.importer.linkExternal(ride, {
      provider: 'garmin',
      externalId: a.activityId,
      activityType: a.activityType.typeKey,
      bikeType,
      durationS: parsed.durationS ?? a.elapsedDuration ?? null,
      movingTimeS: parsed.movingTimeS ?? a.movingDuration ?? null,
      devices: parsed.devices,
    });
    if (result.status === 'conflict') {
      summary.skipped++;
      this.#record(
        a,
        'skipped',
        `covered by ride "${ride.title ?? ride.id}" (Garmin activity ${result.otherId})`,
        null
      );
    } else {
      summary.linked++;
      this.#record(a, 'linked', null, ride.id);
    }
  }
}
