import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GarminAuthError,
  createGarminClient,
  type GarminActivitySummary,
  type GarminApi,
} from '../src/garmin/client.ts';
import { GarminSync, lastSyncRuns } from '../src/garmin/sync.ts';
import { listDevices, listRides } from '../src/rides/repo.ts';
import { buildFit, zipFit } from './helpers/fit.ts';
import { testContext } from './helpers/context.ts';
import { LOOP, LOOP_PARTIAL, ride, toGpx, type XY } from './helpers/tracks.ts';
import { parseGpx } from '../src/parsers/gpx.ts';

// ---- client ---------------------------------------------------------------------------------

function jwt(expSeconds: number): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none' })}.${b64({ exp: expSeconds })}.sig`;
}

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function fakeFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return handler(String(url), init ?? {});
  });
  return { fetchFn: fn as unknown as typeof fetch, calls };
}

const noSleep = async () => {};

describe('Garmin client', () => {
  it('exchanges the key for a token (without Accept header) and reuses it', async () => {
    const now = Date.UTC(2026, 9, 25);
    const { fetchFn, calls } = fakeFetch((url) =>
      url.endsWith('/token') ? new Response(jwt(now / 1000 + 86_400)) : Response.json([])
    );
    const client = createGarminClient({ apiKey: 'k3y', fetchFn, sleep: noSleep, now: () => now });
    await client.listActivities(0, 50);
    await client.listActivities(50, 50);
    const tokenCalls = calls.filter((c) => c.url.endsWith('/token'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0]!.init.headers).toEqual({ Authorization: 'ApiKey k3y' });
    expect(calls[1]!.url).toContain(
      '/activitylist-service/activities/search/activities?start=0&limit=50'
    );
    expect((calls[1]!.init.headers as Record<string, string>).Authorization).toMatch(/^Bearer /);
  });

  it('refreshes the token once when a data call returns 401', async () => {
    let dataCalls = 0;
    const { fetchFn, calls } = fakeFetch((url) => {
      if (url.endsWith('/token')) return new Response(jwt(Date.now() / 1000 + 86_400));
      dataCalls++;
      return dataCalls === 1 ? new Response('', { status: 401 }) : Response.json([]);
    });
    await createGarminClient({ apiKey: 'k', fetchFn, sleep: noSleep }).listActivities(0, 1);
    expect(calls.filter((c) => c.url.endsWith('/token'))).toHaveLength(2);
  });

  it('reports a rejected key as GarminAuthError', async () => {
    const { fetchFn } = fakeFetch(() => new Response('', { status: 401 }));
    await expect(
      createGarminClient({ apiKey: 'bad', fetchFn, sleep: noSleep }).listActivities(0, 1)
    ).rejects.toThrow(GarminAuthError);
  });

  it('backs off on 429 (honouring Retry-After) and 5xx, then succeeds', async () => {
    const sleeps: number[] = [];
    let n = 0;
    const { fetchFn } = fakeFetch((url) => {
      if (url.endsWith('/token')) return new Response(jwt(Date.now() / 1000 + 86_400));
      n++;
      if (n === 1) return new Response('', { status: 429, headers: { 'Retry-After': '7' } });
      if (n === 2) return new Response('', { status: 503 });
      return Response.json([{ activityId: 1 }]);
    });
    const client = createGarminClient({
      apiKey: 'k',
      fetchFn,
      sleep: async (ms) => void sleeps.push(ms),
      minIntervalMs: 0,
    });
    expect(await client.listActivities(0, 1)).toEqual([{ activityId: 1 }]);
    expect(sleeps).toEqual([7000, 2000]);
  });

  it('gives up after the retry budget', async () => {
    const { fetchFn } = fakeFetch((url) =>
      url.endsWith('/token')
        ? new Response(jwt(Date.now() / 1000 + 86_400))
        : new Response('', { status: 500 })
    );
    const client = createGarminClient({ apiKey: 'k', fetchFn, sleep: noSleep, maxRetries: 2 });
    await expect(client.listActivities(0, 1)).rejects.toThrow(/HTTP 500/);
  });
});

// ---- sync -----------------------------------------------------------------------------------

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 4, 1, 6);

interface FakeActivity {
  summary: GarminActivitySummary;
  /** Built lazily: encoding FIT files is the slow part of these tests. */
  zip: () => Uint8Array;
}

function activity(
  id: number,
  typeKey: string,
  day: number,
  waypoints: XY[] = LOOP,
  name = 'Saarbrücken Radfahren'
): FakeActivity {
  const startMs = T0 + day * DAY;
  const gmt = new Date(startMs).toISOString().replace('T', ' ').slice(0, 19);
  return {
    summary: { activityId: id, activityName: name, startTimeGMT: gmt, activityType: { typeKey } },
    zip: () =>
      zipFit(
        buildFit(ride(waypoints, { noiseM: 3, seed: id, startMs }), { withSensors: true }),
        id
      ),
  };
}

/** In-memory Garmin account, newest activity first like the real API. */
class FakeGarmin implements GarminApi {
  activities: FakeActivity[];
  downloads: number[] = [];
  failDownload = new Set<number>();
  constructor(activities: FakeActivity[]) {
    this.activities = activities;
  }
  async listActivities(start: number, limit: number) {
    const sorted = [...this.activities].sort((a, b) =>
      b.summary.startTimeGMT.localeCompare(a.summary.startTimeGMT)
    );
    return sorted.slice(start, start + limit).map((a) => a.summary);
  }
  async downloadActivity(id: number) {
    this.downloads.push(id);
    if (this.failDownload.has(id)) throw new Error('corrupt download');
    return this.activities.find((a) => a.summary.activityId === id)!.zip();
  }
}

describe('Garmin sync', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  });

  async function setup(activities: FakeActivity[]) {
    const ctx = await testContext();
    const fitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fit-'));
    dirs.push(fitDir);
    const api = new FakeGarmin(activities);
    const sync = new GarminSync({
      db: ctx.db,
      api,
      importer: ctx.importer,
      routes: ctx.routes,
      fitDir,
    });
    return { ctx, api, sync, fitDir };
  }

  it('imports outdoor rides, skips the rest, and is idempotent', async () => {
    const { ctx, api, sync, fitDir } = await setup([
      activity(1, 'road_biking', 0),
      activity(2, 'indoor_cycling', 1),
      activity(3, 'walking', 2),
      activity(4, 'gravel_cycling', 3, LOOP, 'Waldrunde'),
      activity(5, 'cycling', 4, LOOP_PARTIAL),
    ]);
    const first = await sync.run();
    expect(first).toMatchObject({ imported: 3, skipped: 2, failed: 0, linked: 0 });

    const rides = listRides(ctx.db);
    expect(rides.map((r) => [r.garmin_activity_id, r.bike_type, r.source])).toEqual([
      [5, null, 'garmin'],
      [4, 'gravel', 'garmin'],
      [1, 'road', 'garmin'],
    ]);
    expect(rides[1]!.title).toBe('Waldrunde');
    expect(rides[0]!.route_id).not.toBe(rides[1]!.route_id);
    expect(rides[1]!.route_id).toBe(rides[2]!.route_id); // same loop on different bikes
    expect(listDevices(ctx.db, rides[0]!.id)).toEqual(
      expect.arrayContaining([expect.objectContaining({ serial_number: 987654 })])
    );
    expect(fs.readdirSync(fitDir).sort()).toEqual(['1.fit', '4.fit', '5.fit']);

    api.downloads = [];
    const second = await sync.run();
    expect(second).toMatchObject({ imported: 0, skipped: 0, linked: 0 });
    expect(api.downloads).toEqual([]);
    expect(lastSyncRuns(ctx.db)[0]).toMatchObject({ status: 'success', imported: 0 });
  });

  it('links rides imported earlier from GPX instead of duplicating them', async () => {
    const { ctx, sync } = await setup([activity(10, 'road_biking', 0, LOOP)]);
    // The same ride, exported as GPX before the sync existed (timestamps 1 s apart from the FIT).
    const gpxPoints = ride(LOOP, { noiseM: 3, seed: 10, startMs: T0 + 1000 });
    const imported = ctx.importer.import(
      parseGpx(toGpx(gpxPoints, { name: '6S Ost 65k Waldtour' })),
      {
        source: 'gpx',
        bikeType: 'gravel',
      }
    );
    expect(imported.status).toBe('imported');

    const result = await sync.run();
    expect(result).toMatchObject({ imported: 0, linked: 1 });
    const rides = listRides(ctx.db);
    expect(rides).toHaveLength(1);
    expect(rides[0]).toMatchObject({
      garmin_activity_id: 10,
      title: '6S Ost 65k Waldtour', // user title kept
      bike_type: 'gravel', // user bike type kept
      source: 'gpx',
      activity_type: 'road_biking',
    });
    expect(listDevices(ctx.db, rides[0]!.id).length).toBeGreaterThan(0);
  });

  it('stops paging once a whole page is already known (incremental)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => activity(100 + i, 'walking', i));
    const { api, sync } = await setup(many);
    await sync.run();
    const listSpy = vi.spyOn(api, 'listActivities');
    api.activities.push(activity(999, 'road_biking', 500));
    const res = await sync.run();
    expect(res.imported).toBe(1);
    // page 1 has the new ride; page 2 is all known → stop (no third page).
    expect(listSpy).toHaveBeenCalledTimes(2);
  });

  it('records failures, retries them later, and gives up after 3 attempts', async () => {
    const { ctx, api, sync } = await setup([activity(1, 'road_biking', 0)]);
    api.failDownload.add(1);
    for (let i = 0; i < 4; i++) await sync.run();
    expect(api.downloads).toEqual([1, 1, 1]);
    const row = ctx.db
      .prepare(`SELECT status, attempts, reason FROM garmin_activities WHERE activity_id = 1`)
      .get();
    expect(row).toEqual({ status: 'failed', attempts: 3, reason: 'corrupt download' });
  });

  it('dry run writes nothing', async () => {
    const { ctx, sync, api } = await setup([
      activity(1, 'road_biking', 0),
      activity(2, 'hiking', 1),
    ]);
    const res = await sync.run({ dryRun: true });
    expect(res.plan.map((p) => p.action)).toEqual(['skip', 'import']);
    expect(listRides(ctx.db)).toHaveLength(0);
    expect(api.downloads).toEqual([]);
    expect(lastSyncRuns(ctx.db)).toHaveLength(0);
  });

  it('aborts on auth errors and records the run as failed', async () => {
    const { ctx, api, sync } = await setup([activity(1, 'road_biking', 0)]);
    vi.spyOn(api, 'listActivities').mockRejectedValue(new GarminAuthError('key expired'));
    await expect(sync.run()).rejects.toThrow('key expired');
    expect(lastSyncRuns(ctx.db)[0]).toMatchObject({ status: 'error', error: 'key expired' });
  });

  it('refuses to run twice at the same time', async () => {
    const { sync } = await setup([activity(1, 'road_biking', 0)]);
    const first = sync.run();
    await expect(sync.run()).rejects.toThrow(/already running/);
    await first;
    expect(sync.isRunning).toBe(false);
  });
});
