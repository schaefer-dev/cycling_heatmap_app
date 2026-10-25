import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppContext } from '../src/app.ts';
import type { GarminActivitySummary, GarminApi } from '../src/garmin/client.ts';
import { GarminSync } from '../src/garmin/sync.ts';
import { dbTokenStore } from '../src/hammerhead/auth.ts';
import {
  HammerheadAuthError,
  HammerheadScopeError,
  createHammerheadClient,
  type HammerheadActivity,
  type HammerheadApi,
  type StoredTokens,
  type TokenStore,
} from '../src/hammerhead/client.ts';
import { HammerheadSync } from '../src/hammerhead/sync.ts';
import { parseFit } from '../src/parsers/fit.ts';
import { parseGpx } from '../src/parsers/gpx.ts';
import type { BikeSensorConfig } from '../src/rides/bikeSensors.ts';
import { DUPLICATE_MIN_OVERLAP } from '../src/rides/importService.ts';
import { listDevices, listRides } from '../src/rides/repo.ts';
import { lastSyncRuns } from '../src/sync/runs.ts';
import { buildFit, zipFit } from './helpers/fit.ts';
import { testContext } from './helpers/context.ts';
import { LOOP, ride, toGpx, type XY } from './helpers/tracks.ts';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.UTC(2026, 4, 1, 6);
/** LOOP is ~20 km; at the helper's 7 m/s it takes ~48 min. */
const LOOP_FIRST_HALF: XY[] = [
  [0, 0],
  [6000, 0],
  [6000, 4000],
];
const LOOP_SECOND_HALF: XY[] = [
  [6000, 4000],
  [0, 4000],
  [0, 0],
];
const HALF_MS = Math.round((10_000 / 7) * 1000);

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

function memoryTokens(initial: StoredTokens | null = null): TokenStore & {
  current: StoredTokens | null;
} {
  const store = {
    current: initial,
    load: () => store.current,
    save: (t: StoredTokens) => void (store.current = t),
    clear: () => void (store.current = null),
  };
  return store;
}

const noSleep = async () => {};
const CLIENT = {
  clientId: 'cid',
  clientSecret: 's3cret',
  redirectUri: 'http://localhost:5173/api/hammerhead/callback',
  authUrl: 'https://hh.test/v1/auth',
  apiUrl: 'https://hh.test/v1/api',
  sleep: noSleep,
  minIntervalMs: 0,
};
const formOf = (init: RequestInit) => Object.fromEntries(new URLSearchParams(String(init.body)));
const tokenJson = (n: number) =>
  Response.json({
    token_type: 'Bearer',
    access_token: `access-${n}`,
    refresh_token: `refresh-${n}`,
    expires_in: 3600,
    user_id: 1000,
  });

// ---- client ---------------------------------------------------------------------------------

describe('Hammerhead client', () => {
  it('builds the authorize URL and exchanges the code (secret only in the POST body)', async () => {
    const tokens = memoryTokens();
    const { fetchFn, calls } = fakeFetch(() => tokenJson(1));
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn, now: () => T0 });

    const url = new URL(client.authorizeUrl('st4te'));
    expect(url.origin + url.pathname).toBe('https://hh.test/v1/auth/oauth/authorize');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: CLIENT.redirectUri,
      response_type: 'code',
      scope: 'activity:read route:read',
      state: 'st4te',
    });

    await client.exchangeCode('c0de');
    expect(calls[0]!.url).toBe('https://hh.test/v1/auth/oauth/token');
    expect(calls[0]!.url).not.toContain('s3cret');
    expect(formOf(calls[0]!.init)).toEqual({
      client_id: 'cid',
      client_secret: 's3cret',
      grant_type: 'authorization_code',
      code: 'c0de',
      redirect_uri: CLIENT.redirectUri,
    });
    expect(tokens.current).toEqual({
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      expiresAt: T0 + 3600_000,
      userId: '1000',
    });
  });

  it('refreshes an expiring token first and persists the rotated refresh token', async () => {
    let now = T0;
    const tokens = memoryTokens({
      accessToken: 'old',
      refreshToken: 'refresh-0',
      expiresAt: T0 + 2 * MIN,
      userId: '1000',
    });
    let issued = 0;
    const { fetchFn, calls } = fakeFetch((url) =>
      url.endsWith('/oauth/token')
        ? tokenJson(++issued)
        : Response.json({ data: [], totalPages: 0 })
    );
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn, now: () => now });
    await client.listActivities(1, 100, '2026-04-24');
    now += MIN;
    await client.listActivities(2, 100);

    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(1);
    expect(formOf(calls[0]!.init)).toMatchObject({
      grant_type: 'refresh_token',
      refresh_token: 'refresh-0',
    });
    expect(tokens.current).toMatchObject({ accessToken: 'access-1', refreshToken: 'refresh-1' });
    expect(calls[1]!.url).toBe(
      'https://hh.test/v1/api/activities?page=1&perPage=100&startDate=2026-04-24'
    );
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toBe(
      'Bearer access-1'
    );
    expect(calls[2]!.url).toBe('https://hh.test/v1/api/activities?page=2&perPage=100');
  });

  it('refreshes once when a data call returns 401', async () => {
    const tokens = memoryTokens({
      accessToken: 'revoked',
      refreshToken: 'r',
      expiresAt: Date.now() + DAY,
      userId: null,
    });
    let dataCalls = 0;
    const { fetchFn, calls } = fakeFetch((url) => {
      if (url.endsWith('/oauth/token')) return tokenJson(1);
      dataCalls++;
      return dataCalls === 1 ? new Response('', { status: 401 }) : Response.json({ id: 'a' });
    });
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn });
    expect(await client.getActivity('1000.activity.a')).toEqual({ id: 'a' });
    expect(calls.map((c) => c.url.replace('https://hh.test/v1', ''))).toEqual([
      '/api/activities/1000.activity.a',
      '/auth/oauth/token',
      '/api/activities/1000.activity.a',
    ]);
  });

  it('reports a rejected refresh token or a missing login as HammerheadAuthError', async () => {
    const tokens = memoryTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: 0,
      userId: null,
    });
    const { fetchFn } = fakeFetch(() => Response.json({ error: 'invalid_grant' }, { status: 400 }));
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn });
    await expect(client.listActivities(1, 10)).rejects.toThrow(HammerheadAuthError);

    const none = createHammerheadClient({ ...CLIENT, tokens: memoryTokens(), fetchFn });
    await expect(none.downloadFit('x')).rejects.toThrow(/not connected/);
  });

  it('lists planned routes, and reports a missing route:read permission without refreshing', async () => {
    const tokens = memoryTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + DAY,
      userId: null,
    });
    let granted = true;
    const { fetchFn, calls } = fakeFetch(() =>
      granted
        ? Response.json({
            totalPages: 1,
            currentPage: 1,
            data: [
              { id: '1000.route.x', name: 'Saarschleife 90k', createdAt: '2026-05-01T10:00:00Z' },
            ],
          })
        : Response.json(
            { reason: 'invalid_token', code: 'unauthorized', message: 'insufficient scopes' },
            { status: 401 }
          )
    );
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn });
    const page = await client.listRoutes(1, 100);
    expect(page.data[0]!.name).toBe('Saarschleife 90k');
    expect(calls[0]!.url).toBe('https://hh.test/v1/api/routes?page=1&perPage=100');

    granted = false;
    await expect(client.listRoutes(1, 100)).rejects.toThrow(HammerheadScopeError);
    expect(calls.filter((c) => c.url.endsWith('/oauth/token'))).toHaveLength(0);
    expect(tokens.current?.accessToken).toBe('a');
  });

  it('backs off on 429/5xx and downloads the raw FIT', async () => {
    const tokens = memoryTokens({
      accessToken: 'a',
      refreshToken: 'r',
      expiresAt: Date.now() + DAY,
      userId: null,
    });
    const sleeps: number[] = [];
    let n = 0;
    const { fetchFn } = fakeFetch(() => {
      n++;
      if (n === 1) return new Response('', { status: 429, headers: { 'Retry-After': '3' } });
      if (n === 2) return new Response('', { status: 502 });
      return new Response(new Uint8Array([1, 2, 3]));
    });
    const client = createHammerheadClient({
      ...CLIENT,
      tokens,
      fetchFn,
      sleep: async (ms) => void sleeps.push(ms),
    });
    expect(Array.from(await client.downloadFit('1000.activity.a'))).toEqual([1, 2, 3]);
    expect(sleeps).toEqual([3000, 2000]);
  });
});

// ---- fakes ----------------------------------------------------------------------------------

interface FakeActivity {
  detail: HammerheadActivity;
  startMs: number;
  fit: () => Uint8Array;
}

function hhActivity(
  id: string,
  startMs: number,
  opts: {
    type?: string;
    waypoints?: XY[];
    name?: string;
    seed?: number;
    gps?: boolean;
    sensors?: boolean;
  } = {}
): FakeActivity {
  const points = ride(opts.waypoints ?? LOOP, { noiseM: 3, seed: opts.seed ?? 1, startMs });
  return {
    startMs,
    detail: {
      id,
      name: opts.name ?? 'Karoo Ride',
      // Upload time: deliberately not the ride start, the sync must not rely on it.
      createdAt: new Date(startMs + 3 * HOUR).toISOString(),
      activityType: opts.type ?? 'RIDE',
    },
    fit: () => buildFit(opts.gps === false ? [] : points, { withSensors: opts.sensors ?? true }),
  };
}

/** In-memory Hammerhead account (paginated, filtered by createdAt date like startDate). */
class FakeHammerhead implements HammerheadApi {
  activities: FakeActivity[];
  downloads: string[] = [];
  listCalls: Array<string | undefined> = [];
  failDownload = new Set<string>();
  constructor(activities: FakeActivity[]) {
    this.activities = activities;
  }
  async listActivities(page: number, perPage: number, startDate?: string) {
    this.listCalls.push(startDate);
    const all = this.activities
      .filter((a) => !startDate || a.detail.createdAt.slice(0, 10) >= startDate)
      .sort((a, b) => b.detail.createdAt.localeCompare(a.detail.createdAt));
    const data = all.slice((page - 1) * perPage, page * perPage).map(({ detail }) => ({
      id: detail.id,
      name: detail.name,
      createdAt: detail.createdAt,
    }));
    return { totalPages: Math.ceil(all.length / perPage), currentPage: page, data };
  }
  async getActivity(id: string) {
    return this.#find(id).detail;
  }
  async listRoutes() {
    return { totalPages: 0, currentPage: 1, data: [] };
  }
  async downloadFit(id: string) {
    this.downloads.push(id);
    if (this.failDownload.has(id)) throw new Error('corrupt download');
    return this.#find(id).fit();
  }
  #find(id: string) {
    return this.activities.find((a) => a.detail.id === id)!;
  }
}

class FakeGarmin implements GarminApi {
  activities: Array<{ summary: GarminActivitySummary; startMs: number; waypoints: XY[] }> = [];
  add(id: number, startMs: number, typeKey = 'road_biking', waypoints: XY[] = LOOP) {
    const gmt = new Date(startMs).toISOString().replace('T', ' ').slice(0, 19);
    this.activities.push({
      summary: {
        activityId: id,
        activityName: 'Garmin title',
        startTimeGMT: gmt,
        activityType: { typeKey },
      },
      startMs,
      waypoints,
    });
  }
  async listActivities(start: number, limit: number) {
    return this.activities.slice(start, start + limit).map((a) => a.summary);
  }
  async downloadActivity(id: number) {
    const a = this.activities.find((x) => x.summary.activityId === id)!;
    return zipFit(buildFit(ride(a.waypoints, { noiseM: 3, seed: id, startMs: a.startMs })), id);
  }
}

const TOKENS: StoredTokens = {
  accessToken: 'access-secret',
  refreshToken: 'refresh-secret',
  expiresAt: Date.now() + DAY,
  userId: '1000',
};

// ---- sync -----------------------------------------------------------------------------------

describe('Hammerhead sync', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  async function setup(
    activities: FakeActivity[] = [],
    connected = true,
    bikeSensors?: BikeSensorConfig
  ) {
    const ctx = await testContext();
    const fitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-'));
    dirs.push(fitDir);
    const tokens = dbTokenStore(ctx.db);
    if (connected) tokens.save(TOKENS);
    const api = new FakeHammerhead(activities);
    const deps = { db: ctx.db, importer: ctx.importer, routes: ctx.routes, fitDir, bikeSensors };
    const sync = new HammerheadSync({ ...deps, api, tokens });
    const garmin = new FakeGarmin();
    const garminSync = new GarminSync({ ...deps, api: garmin });
    /** A ride that arrived earlier through the Garmin sync. */
    const garminRide = async (id: number, startMs: number, waypoints: XY[] = LOOP) => {
      garmin.add(id, startMs, 'road_biking', waypoints);
      await garminSync.run();
    };
    return { ctx, api, sync, garmin, garminSync, garminRide, fitDir };
  }

  it('imports Karoo rides, skips non-rides and indoor rides, and is idempotent', async () => {
    const { ctx, api, sync, fitDir } = await setup([
      hhActivity('1000.activity.a', T0, { type: 'GRAVEL', name: 'Waldrunde' }),
      hhActivity('1000.activity.b', T0 + DAY, { type: 'MOUNTAIN_BIKE', seed: 2 }),
      hhActivity('1000.activity.c', T0 + 2 * DAY, { type: 'RIDE', seed: 3 }),
      hhActivity('1000.activity.d', T0 + 3 * DAY, { type: 'RUN' }),
      hhActivity('1000.activity.e', T0 + 4 * DAY, { gps: false }),
    ]);
    const first = await sync.run();
    expect(first).toMatchObject({ imported: 3, linked: 0, skipped: 2, failed: 0 });

    const rides = listRides(ctx.db);
    expect(
      rides.map((r) => [r.hammerhead_activity_id, r.bike_type, r.source, r.activity_type])
    ).toEqual([
      ['1000.activity.c', null, 'hammerhead', 'cycling'],
      ['1000.activity.b', 'mtb', 'hammerhead', 'mountain_biking'],
      ['1000.activity.a', 'gravel', 'hammerhead', 'gravel_cycling'],
    ]);
    // Ride date comes from the FIT, not from createdAt (upload time).
    expect(rides[2]).toMatchObject({ title: 'Waldrunde', start_time: new Date(T0).toISOString() });
    expect(listDevices(ctx.db, rides[0]!.id).length).toBeGreaterThan(0);
    expect(fs.readdirSync(path.join(fitDir, 'hammerhead')).sort()).toEqual([
      '1000.activity.a.fit',
      '1000.activity.b.fit',
      '1000.activity.c.fit',
      '1000.activity.e.fit',
    ]);

    api.downloads = [];
    expect(await sync.run()).toMatchObject({ imported: 0, linked: 0, skipped: 0, failed: 0 });
    expect(api.downloads).toEqual([]);
    expect(lastSyncRuns(ctx.db, 'hammerhead')[0]).toMatchObject({
      provider: 'hammerhead',
      status: 'success',
    });
    expect(lastSyncRuns(ctx.db, 'garmin')).toHaveLength(0);
  });

  it('classifies generic Karoo rides by their sensors, else by the default', async () => {
    const { ctx, sync } = await setup(
      [
        hhActivity('1000.activity.a', T0, { type: 'RIDE' }),
        hhActivity('1000.activity.b', T0 + DAY, { type: 'RIDE', seed: 2, sensors: false }),
        hhActivity('1000.activity.c', T0 + 2 * DAY, { type: 'MOUNTAIN_BIKE', seed: 3 }),
      ],
      true,
      {
        defaultBikeType: 'road',
        rules: [
          {
            bikeType: 'gravel',
            name: 'Gravel / power',
            deviceType: 'bikePower',
            manufacturer: 'quarq',
            antIds: [4242],
          },
        ],
      }
    );
    await sync.run();
    expect(listRides(ctx.db).map((r) => [r.hammerhead_activity_id, r.bike_type])).toEqual([
      ['1000.activity.c', 'gravel'],
      ['1000.activity.b', 'road'],
      ['1000.activity.a', 'gravel'],
    ]);
  });

  it('links a ride that already came from Garmin (track and title kept, bike type gap filled)', async () => {
    const { ctx, sync, garminRide } = await setup([
      hhActivity('1000.activity.a', T0, { type: 'GRAVEL', name: 'Karoo title' }),
    ]);
    await garminRide(77, T0, LOOP);
    const before = listRides(ctx.db)[0]!;
    ctx.db.prepare(`UPDATE rides SET bike_type = NULL, bike_type_source = NULL`).run();

    expect(await sync.run()).toMatchObject({ imported: 0, linked: 1 });
    const rides = listRides(ctx.db);
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({
      id: before.id,
      source: 'garmin',
      title: 'Garmin title',
      garmin_activity_id: 77,
      hammerhead_activity_id: '1000.activity.a',
      bike_type: 'gravel',
      bike_type_source: 'auto',
      distance_km: before.distance_km,
    });
    const row = ctx.db.prepare(`SELECT status, reason, ride_id FROM hammerhead_activities`).get();
    expect(row).toEqual({ status: 'linked', reason: 'duplicate (start)', ride_id: before.id });
  });

  it('lets a later Garmin sync link to a ride that came from Hammerhead first', async () => {
    const { ctx, sync, garmin, garminSync } = await setup([
      hhActivity('1000.activity.a', T0),
      hhActivity('1000.activity.b', T0 + DAY, { seed: 2 }),
    ]);
    await sync.run();
    garmin.add(5, T0); // same FIT start
    garmin.add(6, T0 + DAY + 5 * MIN); // a second device started 5 min later
    expect(await garminSync.run()).toMatchObject({ imported: 0, linked: 2 });

    const rides = listRides(ctx.db);
    expect(rides.map((r) => [r.source, r.hammerhead_activity_id, r.garmin_activity_id])).toEqual([
      ['hammerhead', '1000.activity.b', 6],
      ['hammerhead', '1000.activity.a', 5],
    ]);
  });

  it('recognises the same ride recorded with a 5 min later start (time overlap)', async () => {
    const { ctx, sync, garminRide } = await setup([hhActivity('1000.activity.a', T0 + 5 * MIN)]);
    await garminRide(1, T0);
    expect(await sync.run()).toMatchObject({ imported: 0, linked: 1 });
    expect(listRides(ctx.db)).toHaveLength(1);
    expect(ctx.db.prepare(`SELECT reason FROM hammerhead_activities`).get()).toEqual({
      reason: 'duplicate (overlap)',
    });
  });

  it('skips the second half of a ride Garmin kept whole (no duplicate, no overwrite)', async () => {
    const { ctx, sync, garminRide } = await setup([
      hhActivity('1000.activity.a', T0, { waypoints: LOOP_FIRST_HALF }),
      hhActivity('1000.activity.b', T0 + HALF_MS, { waypoints: LOOP_SECOND_HALF, seed: 2 }),
    ]);
    await garminRide(1, T0);
    expect(await sync.run()).toMatchObject({ imported: 0, linked: 1, skipped: 1 });

    // Whichever half is processed first is linked; the other one is covered by the same ride.
    const rides = listRides(ctx.db);
    expect(rides).toHaveLength(1);
    const rows = ctx.db
      .prepare(`SELECT activity_id, status, reason FROM hammerhead_activities ORDER BY status`)
      .all() as Array<{ activity_id: string; status: string; reason: string }>;
    expect(rows.map((r) => r.status)).toEqual(['linked', 'skipped']);
    expect(rides[0]!.hammerhead_activity_id).toBe(rows[0]!.activity_id);
    expect(rows[1]!.reason).toContain(
      `already linked to Hammerhead activity ${rows[0]!.activity_id}`
    );
  });

  it('keeps two separate rides on the same day apart', async () => {
    const { ctx, sync, garminRide } = await setup([hhActivity('1000.activity.a', T0 + 6 * HOUR)]);
    await garminRide(1, T0); // morning ride, ~48 min
    expect(await sync.run()).toMatchObject({ imported: 1, linked: 0 });
    expect(listRides(ctx.db)).toHaveLength(2);
  });

  it('detects a GPX upload of a ride that already arrived through Hammerhead', async () => {
    const { ctx, sync } = await setup([hhActivity('1000.activity.a', T0)]);
    await sync.run();
    const gpx = parseGpx(toGpx(ride(LOOP, { noiseM: 3, seed: 9, startMs: T0 + 2 * MIN })));
    const res = ctx.importer.import(gpx, { source: 'gpx', bikeType: null });
    expect(res).toMatchObject({ status: 'duplicate', reason: 'overlap' });
  });

  it('dry run downloads and plans but writes nothing', async () => {
    const { ctx, sync, garminRide, fitDir } = await setup([
      hhActivity('1000.activity.a', T0),
      hhActivity('1000.activity.b', T0 + DAY, { seed: 2 }),
      hhActivity('1000.activity.c', T0 + 2 * DAY, { type: 'SWIM' }),
    ]);
    await garminRide(1, T0);
    const res = await sync.run({ dryRun: true });
    expect(res.plan.map((p) => [p.activityId, p.action])).toEqual([
      ['1000.activity.c', 'skip'],
      ['1000.activity.b', 'import'],
      ['1000.activity.a', 'link'],
    ]);
    expect(res.plan[2]!.detail).toMatch(/^start: ride "Garmin title"/);
    expect(listRides(ctx.db)).toHaveLength(1);
    expect(listRides(ctx.db)[0]!.hammerhead_activity_id).toBeNull();
    expect(ctx.db.prepare(`SELECT COUNT(*) AS n FROM hammerhead_activities`).get()).toEqual({
      n: 0,
    });
    expect(lastSyncRuns(ctx.db, 'hammerhead')).toHaveLength(0);
    expect(fs.existsSync(path.join(fitDir, 'hammerhead'))).toBe(false);
  });

  it('lists only recent activities on incremental runs, everything on backfill', async () => {
    const { api, sync } = await setup([hhActivity('1000.activity.a', T0)]);
    await sync.run();
    await sync.run();
    await sync.run({ mode: 'backfill' });
    const sevenDaysBefore = new Date(T0 - 7 * DAY).toISOString().slice(0, 10);
    expect(api.listCalls).toEqual([undefined, sevenDaysBefore, undefined]);
  });

  it('records failures, retries them later, and gives up after 3 attempts', async () => {
    const { ctx, api, sync } = await setup([hhActivity('1000.activity.a', T0)]);
    api.failDownload.add('1000.activity.a');
    for (let i = 0; i < 4; i++) await sync.run();
    expect(api.downloads).toHaveLength(3);
    expect(
      ctx.db.prepare(`SELECT status, attempts, reason FROM hammerhead_activities`).get()
    ).toEqual({
      status: 'failed',
      attempts: 3,
      reason: 'corrupt download',
    });
  });

  it('aborts on auth errors and does not run until connected', async () => {
    const { ctx, api, sync } = await setup([hhActivity('1000.activity.a', T0)]);
    vi.spyOn(api, 'getActivity').mockRejectedValue(
      new HammerheadAuthError('connect Hammerhead again')
    );
    await expect(sync.run()).rejects.toThrow('connect Hammerhead again');
    expect(lastSyncRuns(ctx.db, 'hammerhead')[0]).toMatchObject({ status: 'error' });

    const offline = await setup([], false);
    expect(offline.sync.isReady()).toBe(false);
    await expect(offline.sync.run()).rejects.toThrow(/not connected/);
    expect(lastSyncRuns(offline.ctx.db, 'hammerhead')).toHaveLength(0);
  });
});

// ---- duplicate rule -------------------------------------------------------------------------

describe('time-overlap duplicate rule', () => {
  it(`treats ≥${DUPLICATE_MIN_OVERLAP * 100}% overlap of the shorter ride as the same ride`, async () => {
    const ctx = await testContext();
    const fit = (startMs: number, seed: number) =>
      parseFit(buildFit(ride(LOOP, { noiseM: 3, seed, startMs })));
    ctx.importer.import(fit(T0, 1), { source: 'gpx', bikeType: null }); // ~08:00–08:48

    // Starts 30 min later: 18 of 48 min shared (37%) → a different ride.
    expect(ctx.importer.findDuplicate(fit(T0 + 30 * MIN, 2))).toBeUndefined();
    // Starts 20 min later: 28 of 48 min shared (58%) → the same ride.
    expect(ctx.importer.findDuplicate(fit(T0 + 20 * MIN, 3))?.reason).toBe('overlap');
    // A short recording entirely inside the ride → the same ride.
    const inside = parseFit(
      buildFit(ride(LOOP_FIRST_HALF, { noiseM: 3, seed: 4, startMs: T0 + 10 * MIN }))
    );
    expect(ctx.importer.findDuplicate(inside)?.reason).toBe('overlap');
    // Starts right after it ended → a different ride.
    expect(ctx.importer.findDuplicate(fit(T0 + 49 * MIN, 5))).toBeUndefined();
  });
});

// ---- API ------------------------------------------------------------------------------------

describe('Hammerhead API', () => {
  async function setup() {
    const base = await testContext();
    const tokens = dbTokenStore(base.db);
    const { fetchFn, calls } = fakeFetch(() => tokenJson(1));
    const client = createHammerheadClient({ ...CLIENT, tokens, fetchFn });
    const ctx: AppContext = {
      ...base,
      hammerheadAuth: client,
      hammerheadSync: new HammerheadSync({
        db: base.db,
        api: client,
        tokens,
        importer: base.importer,
        routes: base.routes,
        fitDir: os.tmpdir(),
      }),
    };
    return { app: createApp(ctx), tokens, calls };
  }

  const connect = async (app: Parameters<typeof request>[0]) => {
    const res = await request(app).get('/api/hammerhead/connect').expect(302);
    return new URL(res.headers.location!).searchParams.get('state')!;
  };

  it('connects via the OAuth redirect and never exposes tokens', async () => {
    const { app, tokens, calls } = await setup();
    let status = await request(app).get('/api/sync/status').expect(200);
    expect(status.body.hammerhead).toMatchObject({ configured: true, connected: false });
    await request(app).post('/api/sync/hammerhead').send({}).expect(400);

    const state = await connect(app);
    const cb = await request(app)
      .get('/api/hammerhead/callback')
      .query({ code: 'c0de', state })
      .expect(302);
    expect(cb.headers.location).toBe('/?hammerhead=connected');
    expect(formOf(calls[0]!.init)).toMatchObject({
      code: 'c0de',
      grant_type: 'authorization_code',
    });
    expect(tokens.load()).toMatchObject({ accessToken: 'access-1', userId: '1000' });

    status = await request(app).get('/api/sync/status').expect(200);
    expect(status.body.hammerhead.connected).toBe(true);
    expect(status.body.garmin.configured).toBe(false);
    expect(JSON.stringify(status.body)).not.toMatch(/access-1|refresh-1|s3cret/);

    // A state is single-use.
    const replay = await request(app).get('/api/hammerhead/callback').query({ code: 'x', state });
    expect(replay.headers.location).toBe('/?hammerhead=error');
  });

  it('rejects unknown states and reports a denied consent', async () => {
    const { app, tokens, calls } = await setup();
    const forged = await request(app)
      .get('/api/hammerhead/callback')
      .query({ code: 'c0de', state: 'forged' });
    expect(forged.headers.location).toBe('/?hammerhead=error');

    const state = await connect(app);
    const denied = await request(app)
      .get('/api/hammerhead/callback')
      .query({ error: 'access_denied', state });
    expect(denied.headers.location).toBe('/?hammerhead=denied');
    expect(calls).toHaveLength(0);
    expect(tokens.load()).toBeNull();
  });

  it('disconnects: deauthorizes at Hammerhead and forgets the tokens', async () => {
    const { app, tokens, calls } = await setup();
    tokens.save(TOKENS);
    await request(app).post('/api/hammerhead/disconnect').expect(200);
    expect(tokens.load()).toBeNull();
    expect(calls[0]!.url).toBe('https://hh.test/v1/auth/oauth/deauthorize');
    expect(formOf(calls[0]!.init)).toMatchObject({ token: 'access-secret' });
  });

  it('explains missing configuration', async () => {
    const app = createApp(await testContext());
    const res = await request(app).get('/api/hammerhead/connect').expect(400);
    expect(res.body.error).toMatch(/HAMMERHEAD_CLIENT_ID/);
  });
});
