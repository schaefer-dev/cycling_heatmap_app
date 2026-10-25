/**
 * The single import pipeline for every source (GPX upload, Garmin sync):
 * duplicate check → one transaction (ride row, track, geometry, cells, devices, route) → done.
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import type { BikeType } from '../domain.ts';
import { elevationGainM, pathLengthM } from '../geo/geo.ts';
import { logger } from '../logger.ts';
import type { RouteService } from '../matching/routeService.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import { computeGeometry } from '../track/geometry.ts';
import * as rides from './repo.ts';

/** Two recordings starting within this window are the same ride. */
export const DUPLICATE_START_TOLERANCE_S = 60;

export interface ImportOptions {
  source: 'gpx' | 'garmin';
  bikeType: BikeType | null;
  garminActivityId?: number | null;
  /** Overrides the parsed title (Garmin activity name). */
  title?: string | null;
  /** Overrides the parsed activity type (Garmin typeKey). */
  activityType?: string | null;
}

export type ImportResult =
  { status: 'imported'; ride: rides.RideRow } | { status: 'duplicate'; existing: rides.RideRow };

export class RideImporter {
  #db: DB;
  #routes: RouteService;
  #dateFormat: Intl.DateTimeFormat;

  constructor(db: DB, routes: RouteService, timeZone: string) {
    this.#db = db;
    this.#routes = routes;
    // en-CA formats as YYYY-MM-DD.
    this.#dateFormat = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
  }

  localDate(ms: number): string {
    return this.#dateFormat.format(new Date(ms));
  }

  findDuplicate(
    parsed: ParsedActivity,
    garminActivityId?: number | null
  ): rides.RideRow | undefined {
    const db = this.#db;
    if (garminActivityId) {
      const byId = rides.findByGarminId(db, garminActivityId);
      if (byId) return byId;
    }
    const start = parsed.points.find((p) => p.time !== null)?.time;
    if (start != null) {
      return rides.findByStartTime(db, start, DUPLICATE_START_TOLERANCE_S)[0];
    }
    if (parsed.points.length === 0) return undefined;
    const first = parsed.points[0]!;
    const last = parsed.points[parsed.points.length - 1]!;
    return rides.findSimilarUntimed(
      db,
      null,
      round2(pathLengthM(parsed.points) / 1000),
      first,
      last
    );
  }

  import(parsed: ParsedActivity, opts: ImportOptions): ImportResult {
    if (parsed.points.length < 2) throw new Error('Track has fewer than 2 GPS points');
    const existing = this.findDuplicate(parsed, opts.garminActivityId);
    if (existing) return { status: 'duplicate', existing };

    const db = this.#db;
    const times = parsed.points.filter((p) => p.time !== null).map((p) => p.time!);
    const startMs = times[0] ?? null;
    const endMs = times[times.length - 1] ?? null;
    const geometry = computeGeometry(parsed.points);
    const id = randomUUID();

    db.transaction(() => {
      rides.insertRide(db, {
        id,
        title: opts.title ?? parsed.title,
        date: startMs !== null ? this.localDate(startMs) : null,
        startTime: startMs !== null ? new Date(startMs).toISOString() : null,
        bikeType: opts.bikeType,
        bikeTypeSource: opts.bikeType ? 'auto' : null,
        distanceKm: round2((parsed.distanceM ?? geometry.lengthM) / 1000),
        elevationGainM: Math.round(
          parsed.elevationGainM ?? elevationGainM(parsed.points.map((p) => p.ele))
        ),
        durationS:
          parsed.durationS ??
          (startMs !== null && endMs !== null ? (endMs - startMs) / 1000 : null),
        movingTimeS: parsed.movingTimeS ?? null,
        source: opts.source,
        activityType:
          opts.activityType ?? (parsed.activityType === 'unknown' ? null : parsed.activityType),
        garminActivityId: opts.garminActivityId ?? null,
      });
      rides.saveTrack(db, id, parsed.points);
      rides.saveGeometry(db, id, geometry);
      if (parsed.devices?.length) rides.saveDevices(db, id, parsed.devices);
      this.#routes.assignRide(id);
    })();

    return { status: 'imported', ride: rides.getRide(db, id)! };
  }
}

/**
 * Brings derived data up to date: geometry for rides that lack it (or have an outdated version),
 * then routes for rides without one. With no routes at all (first run) a full clustering is done,
 * which gives better groups than assigning rides one by one.
 */
export function ensureDerivedData(
  db: DB,
  routes: RouteService
): { geometry: number; routed: number } {
  const ids = rides.rideIdsNeedingGeometry(db);
  if (ids.length > 0) {
    const started = Date.now();
    const save = db.transaction((rideId: string) => {
      const track = rides.loadTrack(db, rideId);
      if (track && track.length >= 2) rides.saveGeometry(db, rideId, computeGeometry(track));
    });
    for (const id of ids) save(id);
    logger.info(`Computed geometry for ${ids.length} ride(s) in ${Date.now() - started} ms`);
  }

  const unrouted = (
    db
      .prepare(
        `SELECT r.id FROM rides r JOIN ride_geometry g ON g.ride_id = r.id
         WHERE r.route_id IS NULL ORDER BY COALESCE(r.start_time, r.date), r.id`
      )
      .all() as Array<{ id: string }>
  ).map((r) => r.id);
  if (unrouted.length === 0) return { geometry: ids.length, routed: 0 };

  const routeCount = (db.prepare(`SELECT COUNT(*) AS n FROM routes`).get() as { n: number }).n;
  if (routeCount === 0) {
    routes.rebuild();
  } else {
    const assign = db.transaction((rideId: string) => routes.assignRide(rideId));
    for (const id of unrouted) assign(id);
  }
  return { geometry: ids.length, routed: unrouted.length };
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
