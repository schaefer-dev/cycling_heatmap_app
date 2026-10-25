import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { buildFit } from './helpers/fit.ts';
import { testApp } from './helpers/context.ts';
import {
  LOOP,
  LOOP_PARTIAL,
  LOOP_WITH_DETOUR,
  reversed,
  ride,
  toGpx,
  toLatLng,
  type XY,
} from './helpers/tracks.ts';

const DAY = 86_400_000;
const T0 = Date.UTC(2025, 5, 1, 7);

function gpxFile(waypoints: XY[], day: number, name = 'Afternoon Ride', seed = day + 1) {
  return Buffer.from(
    toGpx(ride(waypoints, { noiseM: 4, seed, startMs: T0 + day * DAY }), { name, type: 'cycling' })
  );
}

async function upload(
  app: Parameters<typeof request>[0],
  files: Array<[Buffer, string]>,
  fields: Record<string, string> = {}
) {
  let req = request(app).post('/api/rides');
  for (const [buf, name] of files) req = req.attach('files', buf, name);
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  return req;
}

describe('rides API', () => {
  it('imports rides and groups repeats of the same route', async () => {
    const { app } = await testApp();
    const res = await upload(
      app,
      [
        [gpxFile(LOOP, 0, 'Waldrunde'), 'a.gpx'],
        [gpxFile(LOOP_WITH_DETOUR, 7), 'b.gpx'],
        [gpxFile(reversed(LOOP), 14), 'c.gpx'],
        [gpxFile(LOOP_PARTIAL, 21), 'd.gpx'],
      ],
      { bike_type: 'gravel' }
    );
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ total: 4, success: 4, skipped: 0, failed: 0 });

    const routes = await request(app).get('/api/routes');
    expect(routes.body).toHaveLength(2);
    const loop = routes.body.find((r: { ride_count: number }) => r.ride_count === 3);
    expect(loop).toMatchObject({ bike_types: 'gravel' });

    const detail = await request(app).get(`/api/routes/${loop.id}`);
    expect(detail.body.rides.map((r: { date: string }) => r.date)).toEqual([
      '2025-06-15',
      '2025-06-08',
      '2025-06-01',
    ]);
    expect(
      detail.body.rides.find((r: { date: string }) => r.date === '2025-06-15').route_direction
    ).toBe('reverse');
    expect(detail.body.reference_track.length).toBeGreaterThan(3);
  });

  it('names routes from custom titles and from places', async () => {
    const { app, ctx } = await testApp();
    await upload(app, [
      [gpxFile(LOOP, 0, 'Waldrunde'), 'a.gpx'],
      [gpxFile(LOOP_PARTIAL, 1), 'b.gpx'],
    ]);
    await ctx.routes.nameRoutes();
    const names = (await request(app).get('/api/routes')).body
      .map((r: { name: string }) => r.name)
      .sort();
    expect(names[0]).toMatch(/^Place .* loop( via Place .*)? · \d+ km$/);
    expect(names[1]).toBe('Waldrunde');
  });

  it('skips a duplicate upload but keeps a repeat of the same route on another day', async () => {
    const { app } = await testApp();
    const file = gpxFile(LOOP, 0);
    await upload(app, [[file, 'a.gpx']]);
    const again = await upload(app, [
      [file, 'a-copy.gpx'],
      [gpxFile(LOOP, 1), 'next-day.gpx'],
    ]);
    expect(again.body.summary).toMatchObject({ success: 1, skipped: 1 });
    expect(again.body.skipped[0].reason).toMatch(/Already imported/);
  });

  it('imports FIT uploads and leaves generic cycling unassigned', async () => {
    const { app } = await testApp();
    const fit = buildFit(ride(LOOP, { startMs: T0 }), { sport: 'cycling', withSensors: true });
    const res = await upload(app, [[Buffer.from(fit), 'ride.fit']], {
      use_detected_bike_type: 'true',
    });
    expect(res.body.imported[0]).toMatchObject({ bike_type: null, distance_km: 12.35 });
    const detail = await request(app).get(`/api/rides/${res.body.imported[0].id}`);
    expect(detail.body.devices).toEqual(
      expect.arrayContaining([expect.objectContaining({ manufacturer: 'quarq' })])
    );
    const unassigned = await request(app).get('/api/rides?bike_type=unassigned');
    expect(unassigned.body).toHaveLength(1);
  });

  it('previews files without importing, flagging duplicates within the batch', async () => {
    const { app } = await testApp();
    const file = gpxFile(LOOP, 0);
    const res = await request(app)
      .post('/api/rides/preview')
      .attach('files', file, 'a.gpx')
      .attach('files', file, 'b.gpx');
    expect(res.body.previews.map((p: { isDuplicate: boolean }) => p.isDuplicate)).toEqual([
      false,
      true,
    ]);
    expect((await request(app).get('/api/rides')).body).toHaveLength(0);
  });

  it('rejects bad uploads with 400 instead of 500', async () => {
    const { app } = await testApp();
    expect(
      (await request(app).post('/api/rides').attach('files', Buffer.from('x'), 'notes.txt')).status
    ).toBe(400);
    expect((await request(app).post('/api/rides')).status).toBe(400);
    const broken = await upload(app, [[Buffer.from('<gpx></gpx>'), 'broken.gpx']]);
    expect(broken.body.errors).toHaveLength(1);
    expect(
      (
        await request(app)
          .post('/api/rides')
          .field('bike_type', 'unicycle')
          .attach('files', gpxFile(LOOP, 0), 'a.gpx')
      ).status
    ).toBe(400);
  });

  it('returns ride detail, updates and deletes rides', async () => {
    const { app } = await testApp();
    const { body } = await upload(app, [[gpxFile(LOOP, 0), 'a.gpx']]);
    const id = body.imported[0].id;

    const detail = await request(app).get(`/api/rides/${id}`);
    expect(detail.body.track[0]).toHaveLength(2);
    expect(detail.body.track.length).toBe(detail.body.elevation.length);

    const updated = await request(app)
      .patch(`/api/rides/${id}`)
      .send({ title: 'Renamed', bike_type: 'road' });
    expect(updated.body).toMatchObject({
      title: 'Renamed',
      bike_type: 'road',
      bike_type_source: 'user',
    });
    expect((await request(app).patch(`/api/rides/${id}`).send({})).status).toBe(400);
    expect((await request(app).patch(`/api/rides/${id}`).send({ bike_type: 'bmx' })).status).toBe(
      400
    );

    expect((await request(app).delete(`/api/rides/${id}`)).status).toBe(200);
    expect((await request(app).get(`/api/rides/${id}`)).status).toBe(404);
    expect((await request(app).get('/api/routes')).body).toHaveLength(0);
  });

  it('finds rides near a point', async () => {
    const { app } = await testApp();
    await upload(app, [
      [gpxFile(LOOP, 0), 'a.gpx'],
      [gpxFile(LOOP_PARTIAL, 1), 'b.gpx'],
    ]);
    const onBoth = toLatLng([3000, 0]);
    const onlyPartial = toLatLng([-1500, 3000]);
    const nowhere = toLatLng([50_000, 50_000]);
    const near = async (p: { lat: number; lng: number }) =>
      (await request(app).get('/api/rides/near-point').query({ lat: p.lat, lng: p.lng })).body
        .length;
    expect(await near(onBoth)).toBe(2);
    expect(await near(onlyPartial)).toBe(1);
    expect(await near(nowhere)).toBe(0);
    expect(
      (await request(app).get('/api/rides/near-point').query({ lat: 'x', lng: 1 })).status
    ).toBe(400);
  });

  it('reports detours against the route reference', async () => {
    const { app } = await testApp();
    const { body } = await upload(app, [
      [gpxFile(LOOP, 0), 'a.gpx'],
      [gpxFile(LOOP_WITH_DETOUR, 1), 'b.gpx'],
    ]);
    const detourRide = body.imported[1].id;
    const routeId = body.imported[1].route_id;
    const route = (await request(app).get(`/api/routes/${routeId}`)).body;
    const other = route.reference_ride_id === detourRide ? body.imported[0].id : detourRide;
    const dev = (await request(app).get(`/api/rides/${other}/deviation`)).body;
    expect(dev.detours.length + dev.skipped.length).toBeGreaterThan(0);
  });
});

describe('routes API', () => {
  async function setup() {
    const t = await testApp();
    const { body } = await upload(t.app, [
      [gpxFile(LOOP, 0), 'a.gpx'],
      [gpxFile(LOOP, 1), 'b.gpx'],
      [gpxFile(LOOP_PARTIAL, 2), 'c.gpx'],
    ]);
    const [a, , c] = body.imported as Array<{ id: string; route_id: string }>;
    return { ...t, loopRoute: a!.route_id, partialRoute: c!.route_id, partialRide: c!.id };
  }

  it('renames routes and enforces unique names', async () => {
    const { app, loopRoute, partialRoute } = await setup();
    expect(
      (await request(app).patch(`/api/routes/${loopRoute}`).send({ name: 'Hausrunde' })).body
    ).toMatchObject({
      name: 'Hausrunde',
      name_source: 'user',
    });
    expect(
      (await request(app).patch(`/api/routes/${partialRoute}`).send({ name: 'hausrunde' })).status
    ).toBe(409);
  });

  it('moves rides manually and keeps that choice through a rebuild', async () => {
    const { app, loopRoute, partialRide, ctx } = await setup();
    await request(app).put(`/api/rides/${partialRide}/route`).send({ route_id: loopRoute });
    expect((await request(app).get(`/api/routes/${loopRoute}`)).body.ride_count).toBe(3);

    ctx.routes.rebuild();
    const ride = (await request(app).get(`/api/rides/${partialRide}`)).body;
    expect(ride).toMatchObject({ route_id: loopRoute, route_assignment: 'manual' });

    const own = await request(app).put(`/api/rides/${partialRide}/route`).send({ route_id: null });
    expect(own.body.route_id).not.toBe(loopRoute);
  });

  it('merges routes', async () => {
    const { app, loopRoute, partialRoute } = await setup();
    const merged = await request(app)
      .post(`/api/routes/${partialRoute}/merge`)
      .send({ into: loopRoute });
    expect(merged.body.ride_count).toBe(3);
    expect((await request(app).get(`/api/routes/${partialRoute}`)).status).toBe(404);
  });

  it('rebuild keeps route ids and user names stable', async () => {
    const { app, loopRoute } = await setup();
    await request(app).patch(`/api/routes/${loopRoute}`).send({ name: 'Hausrunde' });
    await request(app).post('/api/routes/rebuild');
    const after = (await request(app).get(`/api/routes/${loopRoute}`)).body;
    expect(after).toMatchObject({ name: 'Hausrunde', ride_count: 2 });
  });
});

describe('sections, heatmap and stats API', () => {
  it('creates sections (index 0 kept), validates input, lists and deletes', async () => {
    const { app } = await testApp();
    const { body } = await upload(app, [[gpxFile(LOOP, 0), 'a.gpx']]);
    const rideId = body.imported[0].id;
    const created = await request(app)
      .post('/api/sections')
      .send({
        ride_id: rideId,
        start_lat: 47.5,
        start_lng: 9.5,
        start_index: 0,
        end_lat: 47.51,
        end_lng: 9.51,
        end_index: 40,
        track_segment: Array.from({ length: 20_000 }, () => [47.5, 9.5]), // > old 100 kB body limit
        rating: 'good',
        bike_type: 'gravel',
        surface_tags: ['sand'],
      });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({ start_index: 0, surface_tags: ['sand'] });
    expect(created.body.track_segment).toHaveLength(20_000);

    expect(
      (await request(app).post('/api/sections').send({ ride_id: rideId, rating: 'meh' })).status
    ).toBe(400);
    const id = created.body.id;
    expect(
      (await request(app).put(`/api/sections/${id}`).send({ rating: 'hard' })).body.rating
    ).toBe('hard');
    expect((await request(app).get('/api/sections?rating=hard')).body).toHaveLength(1);
    expect((await request(app).delete(`/api/sections/${id}`)).status).toBe(200);
    expect((await request(app).delete(`/api/sections/${id}`)).status).toBe(404);
  });

  it('serves heatmap points, bounds, tracks and stats', async () => {
    const { app } = await testApp();
    await upload(
      app,
      [
        [gpxFile(LOOP, 0), 'a.gpx'],
        [gpxFile(LOOP, 1), 'b.gpx'],
      ],
      { bike_type: 'road' }
    );
    const heat = (await request(app).get('/api/heatmap')).body;
    // 2 rides × ~20 km at ~50 m spacing
    expect(heat.length).toBeGreaterThan(700);
    expect(heat.length).toBeLessThan(900);
    expect((await request(app).get('/api/heatmap?bike_type=gravel')).body).toHaveLength(0);
    expect((await request(app).get('/api/heatmap/bounds')).body.southwest).toHaveLength(2);
    const tracks = (await request(app).get('/api/heatmap/tracks')).body;
    expect(tracks).toHaveLength(2);
    expect(tracks[0].route_id).toBe(tracks[1].route_id);
    const stats = (await request(app).get('/api/heatmap/stats')).body;
    expect(stats.rides.by_type.road).toBe(2);
    expect(stats.routes).toEqual({ total: 1, repeated: 1 });
  });

  it('answers unknown endpoints with JSON 404 and bad JSON with 400', async () => {
    const { app } = await testApp();
    expect((await request(app).get('/api/nope')).status).toBe(404);
    const bad = await request(app)
      .post('/api/sections')
      .set('Content-Type', 'application/json')
      .send('{bad');
    expect(bad.status).toBe(400);
  });
});
