import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../src/app.ts';
import { dbTokenStore } from '../src/hammerhead/auth.ts';
import {
  HammerheadScopeError,
  type HammerheadApi,
  type HammerheadRouteSummary,
} from '../src/hammerhead/client.ts';
import { plannedRoutesStatus, syncPlannedRoutes } from '../src/hammerhead/plannedRoutes.ts';
import { HammerheadSync } from '../src/hammerhead/sync.ts';
import {
  pairKey,
  suggestPlannedNames,
  type Decisions,
  type GroupStats,
  type PlannedRoute,
} from '../src/matching/plannedSuggestions.ts';
import { parseGpx } from '../src/parsers/gpx.ts';
import { listRides } from '../src/rides/repo.ts';
import { testContext } from './helpers/context.ts';
import { LOOP, LOOP_PARTIAL, ride, toGpx, type XY } from './helpers/tracks.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 1, 8);
const noDecisions: Decisions = { rejected: new Set(), accepted: new Set() };

function group(over: Partial<GroupStats> = {}): GroupStats {
  return {
    routeId: 'g1',
    name: 'Saarbrücken loop via Homburg · 90 km',
    nameSource: 'geo',
    rideCount: 2,
    distanceKm: 90,
    elevationGainM: 700,
    rideStarts: [T0, T0 + 30 * DAY],
    firstRidden: new Date(T0).toISOString(),
    lastRidden: new Date(T0 + 30 * DAY).toISOString(),
    ...over,
  };
}

function plan(
  id: string,
  km: number,
  createdMs: number,
  over: Partial<PlannedRoute> = {}
): PlannedRoute {
  return {
    id,
    name: `5S Route ${id}`,
    createdAt: new Date(createdMs).toISOString(),
    distanceM: km * 1000,
    gainM: 500,
    deleted: false,
    ...over,
  };
}

const names = (s: ReturnType<typeof suggestPlannedNames>) =>
  s.flatMap((g) => g.candidates.map((c) => `${g.group.routeId}:${c.name}:${c.strength}`));

// ---- scoring --------------------------------------------------------------------------------

describe('planned-route suggestions (pure)', () => {
  it('suggests a route planned shortly before a ride of the same length as strong', () => {
    const [s] = suggestPlannedNames([group()], [plan('a', 89.5, T0 - 3 * 3600_000)], noDecisions);
    expect(s!.candidates[0]).toMatchObject({
      name: '5S Route a',
      strength: 'strong',
      lagDays: 0.1,
      distanceDiff: 0.006,
    });
    expect(s!.candidates[0]!.reasons).toEqual([
      'distance +0.6 %',
      'ridden the same day it was planned',
      'elevation 700 m ridden vs 500 m planned',
    ]);
  });

  it('keeps distance within −5 % … +15 % of the plan, strong only within ±5 %', () => {
    const created = T0 - 3600_000;
    const at = (km: number) =>
      suggestPlannedNames([group()], [plan('x', km, created)], noDecisions, {
        includeWeak: true,
      })[0]?.candidates[0]?.strength ?? 'none';
    expect(at(90 / 0.951)).toBe('strong'); // group 4.9 % shorter
    expect(at(90 / 0.94)).toBe('none'); // group 6 % shorter
    expect(at(90 / 1.04)).toBe('strong'); // group 4 % longer
    expect(at(90 / 1.08)).toBe('weak'); // 8 % longer: in the window, but not strong
    expect(at(90 / 1.14)).toBe('weak'); // 14 % longer (riding to the start)
    expect(at(90 / 1.16)).toBe('none');
  });

  it('needs a ride within 2 days of planning for strong; much later or earlier rides make it weak', () => {
    const one = (created: number, includeWeak = true) =>
      suggestPlannedNames([group({ rideStarts: [T0] })], [plan('a', 90, created)], noDecisions, {
        includeWeak,
      })[0]?.candidates[0];
    expect(one(T0 - 1.5 * DAY)!.strength).toBe('strong');
    expect(one(T0 - 5 * DAY)!).toMatchObject({ strength: 'weak', lagDays: 5 });
    // Planned after the only ride: no timing link at all.
    expect(one(T0 + 10 * DAY)!).toMatchObject({ strength: 'weak', lagDays: null });
    expect(one(T0 + 10 * DAY)!.reasons).toContain('no ride shortly after it was planned');
    expect(one(T0 - 5 * DAY, false)).toBeUndefined(); // weak hidden by default
  });

  it('also counts a ride up to 2 days before the route was created (saved after riding it)', () => {
    const one = (created: number) =>
      suggestPlannedNames([group({ rideStarts: [T0] })], [plan('a', 90, created)], noDecisions, {
        includeWeak: true,
      })[0]!.candidates[0]!;
    expect(one(T0 + 21 * 3600_000)).toMatchObject({ strength: 'strong', lagDays: -0.9 });
    expect(one(T0 + 21 * 3600_000).reasons).toContain('ridden 21 h before the route was saved');
    expect(one(T0 + 1.9 * DAY).reasons).toContain('ridden 2 days before the route was saved');
    expect(one(T0 + 3 * 3600_000)).toMatchObject({ strength: 'strong', lagDays: 0 }); // same time
    expect(one(T0 + 2.5 * DAY)).toMatchObject({ strength: 'weak', lagDays: null });
  });

  it('prefers the ride closest to the planning date, before or after', () => {
    const [s] = suggestPlannedNames(
      [group({ rideStarts: [T0 - 1.5 * DAY, T0 + 0.5 * DAY] })],
      [plan('a', 90, T0)],
      noDecisions
    );
    expect(s!.candidates[0]).toMatchObject({ strength: 'strong', lagDays: 0.5 });
  });

  it('never suggests for user-named or already accepted groups, rejected pairs, generic or deleted plans', () => {
    const created = T0 - 3600_000;
    const planned = [
      plan('ok', 90, created),
      plan('rej', 90, created, { name: '4SG Rejected one' }),
      plan('gen', 90, created, { name: 'Afternoon Ride' }),
      plan('del', 90, created, { name: '6S Deleted one', deleted: true }),
    ];
    const decisions: Decisions = {
      rejected: new Set([pairKey('g1', 'rej')]),
      accepted: new Set(['g3']),
    };
    const groups = [
      group(),
      group({ routeId: 'g2', nameSource: 'user' }),
      group({ routeId: 'g3' }),
      group({ routeId: 'g4', nameSource: 'title', name: 'Waldrunde' }),
    ];
    expect(names(suggestPlannedNames(groups, planned, decisions))).toEqual([
      'g1:5S Route ok:strong',
      'g4:5S Route ok:strong',
      'g4:4SG Rejected one:strong',
    ]);
  });

  it('only suggests rated planned routes ("1S"…"6S", optional G/R suffix)', () => {
    const created = T0 - 3600_000;
    const planned = [
      '6S Ost 65k Waldtour',
      '5SR Rennrad Nied',
      '6SG Biotop Beeden',
      '1S Kurz',
      '?S Storchennester Runde',
      '7S Zu viel',
      '5Sterne Runde',
      'Frankreich Gravel Runde 54',
    ].map((name, i) => plan(`p${i}`, 90, created, { name }));
    const s = suggestPlannedNames([group()], planned, noDecisions, { includeWeak: true });
    expect(s[0]!.candidates.map((c) => c.name).sort()).toEqual([
      '1S Kurz',
      '5SR Rennrad Nied',
      '6S Ost 65k Waldtour',
      '6SG Biotop Beeden',
    ]);
  });

  it('merges plans with the same name, lists every strong candidate, counts other groups', () => {
    const created = T0 - 3600_000;
    const s = suggestPlannedNames(
      [group(), group({ routeId: 'g2', distanceKm: 89 })],
      [
        plan('a1', 90, created, { name: '6S Waldrunde #2' }),
        plan('a2', 95, created, { name: '6S Waldrunde' }),
        plan('b', 91, created, { name: '5SR Ostrunde' }),
      ],
      noDecisions
    );
    expect(s[0]!.candidates.map((c) => c.name)).toEqual(['6S Waldrunde #2', '5SR Ostrunde']);
    expect(s[0]!.candidates.every((c) => c.otherGroups === 1)).toBe(true);
  });

  it('caps weak candidates at 3 and ranks groups with a strong candidate first', () => {
    const planned = [1.01, 1.02, 1.03, 1.04, 1.05].map((f, i) =>
      plan(`w${i}`, 80 / f, T0 - 90 * DAY)
    );
    const s = suggestPlannedNames(
      [group({ routeId: 'weak', distanceKm: 80 }), group({ routeId: 'strong' })],
      [...planned, plan('s', 90, T0 - 3600_000)],
      noDecisions,
      { includeWeak: true }
    );
    expect(s[0]!.group.routeId).toBe('strong');
    expect(s.find((g) => g.group.routeId === 'weak')!.candidates).toHaveLength(3);
  });
});

// ---- API ------------------------------------------------------------------------------------

function gpx(waypoints: XY[], startMs: number, seed: number) {
  return parseGpx(toGpx(ride(waypoints, { noiseM: 3, seed, startMs }), { name: 'Afternoon Ride' }));
}

class FakeLibrary implements HammerheadApi {
  routes: HammerheadRouteSummary[] = [];
  fail: Error | null = null;
  async listActivities() {
    return { totalPages: 1, currentPage: 1, data: [] };
  }
  async getActivity(): Promise<never> {
    throw new Error('unused');
  }
  async downloadFit(): Promise<never> {
    throw new Error('unused');
  }
  async listRoutes(page: number, perPage: number) {
    if (this.fail) throw this.fail;
    return {
      totalPages: Math.ceil(this.routes.length / perPage),
      currentPage: page,
      data: this.routes.slice((page - 1) * perPage, page * perPage),
    };
  }
}

describe('suggestions API', () => {
  async function setup() {
    const base = await testContext();
    const tokens = dbTokenStore(base.db);
    tokens.save({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + DAY, userId: '1' });
    const library = new FakeLibrary();
    const hammerheadSync = new HammerheadSync({
      db: base.db,
      api: library,
      tokens,
      importer: base.importer,
      routes: base.routes,
      fitDir: '/nonexistent',
    });
    const ctx: AppContext = { ...base, hammerheadSync };
    // Two route groups: the loop (ridden twice) and a different loop of similar length.
    for (const [w, day, seed] of [
      [LOOP, 0, 1],
      [LOOP, 7, 2],
      [LOOP_PARTIAL, 3, 3],
    ] as const) {
      ctx.importer.import(gpx(w, T0 + day * DAY, seed), { source: 'gpx', bikeType: null });
    }
    await ctx.routes.nameRoutes();
    const routes = ctx.db
      .prepare(`SELECT id, name, name_source FROM routes ORDER BY id`)
      .all() as Array<{ id: string; name: string; name_source: string }>;
    const first = listRides(ctx.db).find((r) => r.start_time === new Date(T0).toISOString())!;
    const loopRoute = first.route_id!;
    const loopKm = first.distance_km!;
    return { ctx, app: createApp(ctx), library, routes, loopRoute, loopKm };
  }

  it('lists suggestions without changing anything, even through a full sync', async () => {
    const { ctx, app, library, routes, loopRoute, loopKm } = await setup();
    library.routes = [
      {
        id: '1.route.wald',
        name: '6S Waldrunde',
        createdAt: new Date(T0 - 3600_000).toISOString(),
        distance: loopKm * 1000,
        gain: 50,
      },
      {
        id: '1.route.gen',
        name: 'Morning Ride',
        createdAt: new Date(T0 - 3600_000).toISOString(),
        distance: loopKm * 1000,
      },
    ];
    await ctx.hammerheadSync!.run(); // also mirrors the library
    await ctx.routes.nameRoutes();

    const res = await request(app).get('/api/suggestions').expect(200);
    expect(res.body.planned_routes).toMatchObject({ count: 2, rated: 1, error: null });
    expect(res.body.counts.strong).toBe(1);
    expect(res.body.groups).toHaveLength(1);
    expect(res.body.groups[0].route.id).toBe(loopRoute);
    expect(res.body.groups[0].candidates[0]).toMatchObject({
      planned_route_id: '1.route.wald',
      name: '6S Waldrunde',
      strength: 'strong',
    });

    // Nothing applied: names, sources and links are exactly as before.
    expect(ctx.db.prepare(`SELECT id, name, name_source FROM routes ORDER BY id`).all()).toEqual(
      routes
    );
    expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM planned_route_links`).get()).toEqual({ n: 0 });
  });

  it('accept renames (protected as a user name) and labels the rides; reject hides; unlink keeps the name', async () => {
    const { ctx, app, library, loopRoute, loopKm } = await setup();
    library.routes = [
      {
        id: '1.route.wald',
        name: '6S Waldrunde',
        createdAt: new Date(T0 - 3600_000).toISOString(),
        distance: loopKm * 1000,
      },
      {
        id: '1.route.ost',
        name: '5SR Ostrunde',
        createdAt: new Date(T0 - 7200_000).toISOString(),
        distance: loopKm * 1000,
      },
    ];
    await request(app).post('/api/suggestions/refresh').expect(200);
    // Another group already uses the name → the accepted one becomes "6S Waldrunde (2)".
    const other = ctx.db.prepare(`SELECT id FROM routes WHERE id != ?`).get(loopRoute) as {
      id: string;
    };
    ctx.routes.rename(other.id, '6S Waldrunde');

    await request(app)
      .post('/api/suggestions/reject')
      .send({ route_id: loopRoute, planned_route_id: '1.route.ost' })
      .expect(200);
    let list = await request(app).get('/api/suggestions').expect(200);
    expect(list.body.groups[0].candidates.map((c: { name: string }) => c.name)).toEqual([
      '6S Waldrunde',
    ]);

    const accepted = await request(app)
      .post('/api/suggestions/accept')
      .send({ route_id: loopRoute, planned_route_id: '1.route.wald' })
      .expect(200);
    expect(accepted.body.name).toBe('6S Waldrunde (2)');
    expect(
      ctx.db.prepare(`SELECT name, name_source FROM routes WHERE id = ?`).get(loopRoute)
    ).toEqual({
      name: '6S Waldrunde (2)',
      name_source: 'user',
    });
    const rides = await request(app).get('/api/rides').expect(200);
    const labels = rides.body.map((r: { route_id: string; planned_route_name: string | null }) => [
      r.route_id === loopRoute,
      r.planned_route_name,
    ]);
    expect(labels).toEqual(
      expect.arrayContaining([
        [true, '6S Waldrunde'],
        [false, null],
      ])
    );
    const route = await request(app).get(`/api/routes/${loopRoute}`).expect(200);
    expect(route.body.planned_route_name).toBe('6S Waldrunde');

    // Accepted groups get no further suggestions; automatic naming leaves them alone.
    list = await request(app).get('/api/suggestions?include_weak=true').expect(200);
    expect(list.body.groups.map((g: { route: { id: string } }) => g.route.id)).not.toContain(
      loopRoute
    );
    await ctx.routes.nameRoutes();
    expect(
      (ctx.db.prepare(`SELECT name FROM routes WHERE id = ?`).get(loopRoute) as { name: string })
        .name
    ).toBe('6S Waldrunde (2)');

    await request(app).delete(`/api/suggestions/links/${loopRoute}`).expect(200);
    const after = await request(app).get(`/api/routes/${loopRoute}`).expect(200);
    expect(after.body).toMatchObject({ name: '6S Waldrunde (2)', planned_route_name: null });
  });

  it('validates decisions', async () => {
    const { app, loopRoute } = await setup();
    await request(app).post('/api/suggestions/accept').send({}).expect(400);
    await request(app)
      .post('/api/suggestions/accept')
      .send({ route_id: loopRoute, planned_route_id: 'nope' })
      .expect(404);
    await request(app).delete(`/api/suggestions/links/${loopRoute}`).expect(404);
  });
});

// ---- library sync ---------------------------------------------------------------------------

describe('planned-route library sync', () => {
  it('upserts, marks removed routes deleted, and records a missing permission without failing the ride sync', async () => {
    const ctx = await testContext();
    const tokens = dbTokenStore(ctx.db);
    tokens.save({ accessToken: 'a', refreshToken: 'r', expiresAt: Date.now() + DAY, userId: '1' });
    const library = new FakeLibrary();
    library.routes = Array.from({ length: 120 }, (_, i) => ({
      id: `1.route.${i}`,
      name: `Route ${i}`,
      createdAt: new Date(T0).toISOString(),
      distance: 50_000 + i,
    }));
    expect(await syncPlannedRoutes(ctx.db, library)).toEqual({
      total: 120,
      added: 120,
      deleted: 0,
    });
    library.routes = library.routes.slice(0, 100);
    await new Promise((r) => setTimeout(r, 5)); // distinct synced_at
    expect(await syncPlannedRoutes(ctx.db, library)).toEqual({ total: 100, added: 0, deleted: 20 });
    expect(plannedRoutesStatus(ctx.db)).toMatchObject({ count: 100, error: null });

    library.fail = new HammerheadScopeError('Hammerhead login lacks a permission for /routes');
    const sync = new HammerheadSync({
      db: ctx.db,
      api: library,
      tokens,
      importer: ctx.importer,
      routes: ctx.routes,
      fitDir: '/nonexistent',
    });
    expect(await sync.run()).toMatchObject({ failed: 0 });
    expect(plannedRoutesStatus(ctx.db)).toMatchObject({
      count: 100,
      error: 'Hammerhead login lacks a permission for /routes',
    });
  });
});
