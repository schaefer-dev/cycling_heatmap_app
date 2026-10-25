/**
 * The single import pipeline for every source (GPX/FIT upload, Garmin and Hammerhead sync):
 * duplicate check → one transaction (ride row, track, geometry, cells, devices, route) → done.
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { BikeType, Provider, RideDevice } from '../domain.ts';
import { elevationGainM, pathLengthM } from '../geo/geo.ts';
import { logger } from '../logger.ts';
import type { RouteService } from '../matching/routeService.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import { computeGeometry } from '../track/geometry.ts';
import * as rides from './repo.ts';

/** Two recordings starting within this window are the same ride. */
export const DUPLICATE_START_TOLERANCE_S = 60;
/**
 * Two recordings overlapping in time by at least this share of the shorter one are the same ride
 * (nobody rides twice at once): catches a second device started minutes later, or one platform
 * splitting a ride the other kept whole.
 */
export const DUPLICATE_MIN_OVERLAP = 0.5;

/** Provider activity ids a recording is known under. */
export interface ExternalIds {
  garmin?: number | null;
  hammerhead?: string | null;
}

export type DuplicateReason = 'id' | 'start' | 'overlap' | 'untimed';

export interface Duplicate {
  ride: rides.RideRow;
  reason: DuplicateReason;
}

export interface ImportOptions {
  source: rides.RideSource;
  bikeType: BikeType | null;
  garminActivityId?: number | null;
  hammerheadActivityId?: string | null;
  /** Overrides the parsed title (provider activity name). */
  title?: string | null;
  /** Overrides the parsed activity type (Garmin typeKey). */
  activityType?: string | null;
}

export type ImportResult =
  | { status: 'imported'; ride: rides.RideRow }
  | { status: 'duplicate'; existing: rides.RideRow; reason: DuplicateReason };

/** Provider metadata attached to an existing ride when the same recording arrives again. */
export interface ExternalLink {
  provider: Provider;
  externalId: number | string;
  activityType: string | null;
  bikeType: BikeType | null;
  durationS: number | null;
  movingTimeS: number | null;
  devices?: readonly RideDevice[];
}

export type LinkResult =
  | { status: 'linked' }
  /** The ride already belongs to a different activity of the same provider; nothing written. */
  | { status: 'conflict'; otherId: number | string };

const ID_COLUMN = { garmin: 'garmin_activity_id', hammerhead: 'hammerhead_activity_id' } as const;

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

  /**
   * The archived ride this recording is a copy of, whatever source either came from: same
   * provider id, start within ±60 s, ≥50 % time overlap, or (no timestamps) same length and ends.
   */
  findDuplicate(parsed: ParsedActivity, ids: ExternalIds = {}): Duplicate | undefined {
    const db = this.#db;
    const byId =
      (ids.garmin ? rides.findByGarminId(db, ids.garmin) : undefined) ??
      (ids.hammerhead ? rides.findByHammerheadId(db, ids.hammerhead) : undefined);
    if (byId) return { ride: byId, reason: 'id' };

    const times = parsed.points.filter((p) => p.time !== null).map((p) => p.time!);
    if (times.length > 0) {
      const start = times[0]!;
      const end = times[times.length - 1]!;
      const sameStart = rides.findByStartTime(db, start, DUPLICATE_START_TOLERANCE_S)[0];
      if (sameStart) return { ride: sameStart, reason: 'start' };
      const overlapping = rides.findOverlapping(db, start, end)[0];
      if (overlapping && overlapping.overlap >= DUPLICATE_MIN_OVERLAP) {
        return { ride: overlapping.ride, reason: 'overlap' };
      }
      return undefined;
    }

    if (parsed.points.length === 0) return undefined;
    const first = parsed.points[0]!;
    const last = parsed.points[parsed.points.length - 1]!;
    const similar = rides.findSimilarUntimed(
      db,
      null,
      round2(pathLengthM(parsed.points) / 1000),
      first,
      last
    );
    return similar ? { ride: similar, reason: 'untimed' } : undefined;
  }

  /**
   * Attaches a provider's id and metadata to an existing ride. Title, track and user choices are
   * kept (first import wins); only empty fields are filled.
   */
  linkExternal(ride: rides.RideRow, link: ExternalLink): LinkResult {
    const db = this.#db;
    const column = ID_COLUMN[link.provider];
    const current = rides.getRide(db, ride.id)?.[column] ?? null;
    if (current !== null && current !== link.externalId) {
      return { status: 'conflict', otherId: current };
    }
    db.transaction(() => {
      stmt(
        db,
        `UPDATE rides SET ${column} = ?, activity_type = COALESCE(activity_type, ?),
           duration_s = COALESCE(duration_s, ?), moving_time_s = COALESCE(moving_time_s, ?),
           bike_type = COALESCE(bike_type, ?),
           bike_type_source = CASE WHEN bike_type IS NULL AND ? IS NOT NULL THEN 'auto' ELSE bike_type_source END
         WHERE id = ?`
      ).run(
        link.externalId,
        link.activityType,
        link.durationS,
        link.movingTimeS,
        link.bikeType,
        link.bikeType,
        ride.id
      );
      // The other copy came from the same head unit; keep the devices it brought, if any.
      if (link.devices?.length && !rides.hasDevices(db, ride.id)) {
        rides.saveDevices(db, ride.id, link.devices);
      }
    })();
    return { status: 'linked' };
  }

  import(parsed: ParsedActivity, opts: ImportOptions): ImportResult {
    if (parsed.points.length < 2) throw new Error('Track has fewer than 2 GPS points');
    const duplicate = this.findDuplicate(parsed, {
      garmin: opts.garminActivityId,
      hammerhead: opts.hammerheadActivityId,
    });
    if (duplicate)
      return { status: 'duplicate', existing: duplicate.ride, reason: duplicate.reason };

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
        hammerheadActivityId: opts.hammerheadActivityId ?? null,
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
