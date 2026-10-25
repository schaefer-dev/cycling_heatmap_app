/**
 * Ties the pure matching logic to the database: assigning new rides, full rebuilds, manual edits
 * and naming.
 */
import { randomUUID } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import { ConflictError, NotFoundError } from '../errors.ts';
import { haversineM } from '../geo/geo.ts';
import { logger } from '../logger.ts';
import { getRide, loadAllShapes, loadShape } from '../rides/repo.ts';
import {
  TrackCache,
  clusterRides,
  compareRides,
  findBestRoute,
  medoid,
  type RideShape,
} from './clustering.ts';
import type { Geocoder } from './geocoder.ts';
import {
  LOOP_MAX_GAP_M,
  fallbackName,
  farthestPoint,
  geoName,
  pickTitleName,
  uniqueName,
} from './naming.ts';
import * as routes from './routeRepo.ts';
import { DEFAULT_MATCH_SETTINGS, findDeviations, type MatchSettings } from './similarity.ts';

export class RouteService {
  #db: DB;
  #settings: MatchSettings;
  #geocoder: Geocoder;

  constructor(db: DB, geocoder: Geocoder, settings: MatchSettings = DEFAULT_MATCH_SETTINGS) {
    this.#db = db;
    this.#geocoder = geocoder;
    this.#settings = settings;
  }

  get settings(): MatchSettings {
    return this.#settings;
  }

  /**
   * Puts a (new) ride on its best matching route, or starts a new route. Synchronous so it can run
   * inside the import transaction. Returns the route id.
   */
  assignRide(rideId: string): string | null {
    const db = this.#db;
    const shape = loadShape(db, rideId);
    if (!shape) return null;
    const cache = new TrackCache(this.#settings.toleranceM);
    const candidates = routes
      .candidateRoutes(db, routes.rideCells(db, rideId))
      .filter((c) => c.referenceRideId !== rideId)
      .map((c) => ({ routeId: c.routeId, reference: loadShape(db, c.referenceRideId) }))
      .filter((c): c is { routeId: string; reference: RideShape } => c.reference !== null);

    const match = findBestRoute(shape, candidates, this.#settings, cache);
    if (match) {
      routes.assignRideToRoute(db, rideId, match.routeId, match, 'auto');
      this.recenterRoute(match.routeId, cache);
      return match.routeId;
    }
    const routeId = randomUUID();
    routes.createRoute(db, routeId, rideId);
    routes.assignRideToRoute(db, rideId, routeId, { score: 1, direction: 'forward' }, 'auto');
    return routeId;
  }

  /** Recomputes the route's reference (medoid) and every member's similarity to it. */
  recenterRoute(routeId: string, cache = new TrackCache(this.#settings.toleranceM)): void {
    const db = this.#db;
    const members = routes
      .routeMemberIds(db, routeId)
      .map((id) => loadShape(db, id))
      .filter((s): s is RideShape => s !== null);
    if (members.length === 0) {
      routes.deleteRoute(db, routeId);
      return;
    }
    const reference = medoid(members, this.#settings, cache);
    routes.setReference(db, routeId, reference.id);
    for (const m of members) {
      const cmp = compareRides(m, reference, this.#settings, cache);
      stmt(db, `UPDATE rides SET route_similarity = ?, route_direction = ? WHERE id = ?`).run(
        cmp.score,
        cmp.direction,
        m.id
      );
    }
  }

  /**
   * Re-clusters all rides from scratch. Manual assignments stay together, existing route ids (and
   * their names) are reused for the clusters that share most rides with them.
   */
  rebuild(): { routes: number; rides: number; ms: number } {
    const db = this.#db;
    const started = Date.now();
    const shapes = loadAllShapes(db);
    const manual = stmt(
      db,
      `SELECT id, route_id FROM rides WHERE route_assignment = 'manual' AND route_id IS NOT NULL`
    ).all() as Array<{ id: string; route_id: string }>;
    const fixed = new Map(manual.map((m) => [m.id, m.route_id]));
    const clusters = clusterRides(shapes, this.#settings, fixed);

    const previous = new Map<string, string>(); // ride -> old route
    for (const r of stmt(
      db,
      `SELECT id, route_id FROM rides WHERE route_id IS NOT NULL`
    ).all() as Array<{
      id: string;
      route_id: string;
    }>) {
      previous.set(r.id, r.route_id);
    }

    db.transaction(() => {
      // Manually pinned groups keep their route id; then the biggest clusters pick theirs.
      const usedOld = new Set(clusters.flatMap((c) => (c.fixedKey ? [c.fixedKey] : [])));
      const ordered = [...clusters].sort(
        (a, b) =>
          Number(!!b.fixedKey) - Number(!!a.fixedKey) ||
          b.members.length - a.members.length ||
          a.key.localeCompare(b.key)
      );
      for (const c of ordered) {
        const votes = new Map<string, number>();
        for (const m of c.members) {
          const old = previous.get(m.rideId);
          if (old && !usedOld.has(old)) votes.set(old, (votes.get(old) ?? 0) + 1);
        }
        const reused =
          c.fixedKey ??
          [...votes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
        const routeId = reused ?? randomUUID();
        if (reused) {
          usedOld.add(reused);
          routes.setReference(db, reused, c.referenceId);
        } else {
          routes.createRoute(db, routeId, c.referenceId);
        }
        for (const m of c.members) {
          const assignment = fixed.has(m.rideId) ? 'manual' : 'auto';
          routes.assignRideToRoute(db, m.rideId, routeId, m, assignment);
        }
      }
      routes.deleteEmptyRoutes(db);
    })();

    const ms = Date.now() - started;
    logger.info(`Route rebuild: ${shapes.length} rides → ${clusters.length} routes in ${ms} ms`);
    return { routes: clusters.length, rides: shapes.length, ms };
  }

  // ---- manual edits ---------------------------------------------------------------------------

  /** Moves a ride to another route, or to a new route of its own when `targetRouteId` is null. */
  moveRide(rideId: string, targetRouteId: string | null): string {
    const db = this.#db;
    const ride = getRide(db, rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    if (targetRouteId && !routes.getRoute(db, targetRouteId))
      throw new NotFoundError('Route not found');
    return db.transaction(() => {
      const from = ride.route_id;
      let target = targetRouteId;
      if (!target) {
        target = randomUUID();
        routes.createRoute(db, target, rideId);
      }
      // Pin the whole target route: the user decided these rides belong together.
      stmt(db, `UPDATE rides SET route_assignment = 'manual' WHERE route_id = ?`).run(target);
      routes.assignRideToRoute(db, rideId, target, null, 'manual');
      this.recenterRoute(target);
      if (from && from !== target) this.recenterRoute(from);
      return target;
    })();
  }

  /** Merges `sourceId` into `targetId`; the merged rides count as manually assigned. */
  mergeRoutes(sourceId: string, targetId: string): void {
    const db = this.#db;
    if (sourceId === targetId) return;
    if (!routes.getRoute(db, sourceId) || !routes.getRoute(db, targetId)) {
      throw new NotFoundError('Route not found');
    }
    db.transaction(() => {
      stmt(
        db,
        `UPDATE rides SET route_id = ?, route_assignment = 'manual' WHERE route_id IN (?, ?)`
      ).run(targetId, sourceId, targetId);
      routes.deleteRoute(db, sourceId);
      this.recenterRoute(targetId);
    })();
  }

  rename(routeId: string, name: string): void {
    const db = this.#db;
    if (!routes.getRoute(db, routeId)) throw new NotFoundError('Route not found');
    const trimmed = name.trim();
    if (routes.isNameTaken(db, trimmed, routeId))
      throw new ConflictError('Another route already has this name');
    routes.setRouteName(db, routeId, trimmed, 'user');
  }

  // ---- deviations -----------------------------------------------------------------------------

  deviation(rideId: string) {
    const db = this.#db;
    const ride = getRide(db, rideId);
    if (!ride) throw new NotFoundError('Ride not found');
    const route = ride.route_id ? routes.getRoute(db, ride.route_id) : undefined;
    if (!route?.reference_ride_id || route.reference_ride_id === rideId) {
      return {
        routeId: route?.id ?? null,
        referenceRideId: route?.reference_ride_id ?? null,
        detours: [],
        skipped: [],
        detourLengthM: 0,
        skippedLengthM: 0,
      };
    }
    const a = loadShape(db, rideId);
    const b = loadShape(db, route.reference_ride_id);
    if (!a || !b) throw new NotFoundError('Ride geometry missing');
    return {
      routeId: route.id,
      referenceRideId: b.id,
      ...findDeviations(a.line, b.line, this.#settings),
    };
  }

  // ---- naming ---------------------------------------------------------------------------------

  /**
   * Gives every route without a user-chosen name the best automatic name: a custom ride title if
   * any member has one, else place names, else a fallback. Async because of geocoding; never runs
   * inside a transaction.
   */
  async nameRoutes(): Promise<number> {
    const db = this.#db;
    let changed = 0;
    for (const route of routes.routesNeedingName(db)) {
      const members = routes.memberTitles(db, route.id);
      if (members.length === 0) continue;
      const titleName = pickTitleName(
        members.map((m) => ({ title: m.title, time: Date.parse(m.t) || 0 }))
      );
      let next: { name: string; source: routes.NameSource } | null;

      if (titleName) {
        next = { name: titleName, source: 'title' };
      } else if (route.name_source === 'geo' && route.name) {
        continue; // stable: don't re-geocode routes that already have a place name
      } else {
        next = await this.#placeBasedName(route.reference_ride_id, members[0]?.bike_type ?? null);
      }
      if (!next) continue;
      const base = next.name;
      if (
        route.name &&
        (route.name === base || route.name.startsWith(`${base} (`)) &&
        route.name_source === next.source
      ) {
        continue;
      }
      const name = uniqueName(base, (n) => routes.isNameTaken(db, n, route.id));
      routes.setRouteName(db, route.id, name, next.source);
      changed++;
    }
    return changed;
  }

  async #placeBasedName(
    referenceRideId: string | null,
    bikeType: string | null
  ): Promise<{ name: string; source: routes.NameSource } | null> {
    if (!referenceRideId) return null;
    const shape = loadShape(this.#db, referenceRideId);
    if (!shape || shape.line.length === 0) return null;
    const start = shape.line[0]!;
    const end = shape.line[shape.line.length - 1]!;
    const isLoop = haversineM(start.lat, start.lng, end.lat, end.lng) < LOOP_MAX_GAP_M;
    const far = farthestPoint(shape.line);
    const startPlace = await this.#geocoder.placeName(start.lat, start.lng);
    if (!startPlace) return { name: fallbackName(shape.lengthM, bikeType), source: 'fallback' };
    const farPlace = await this.#geocoder.placeName(far.lat, far.lng);
    const endPlace = isLoop ? null : await this.#geocoder.placeName(end.lat, end.lng);
    return {
      name: geoName({ startPlace, farPlace, endPlace, isLoop, lengthM: shape.lengthM }),
      source: 'geo',
    };
  }
}
