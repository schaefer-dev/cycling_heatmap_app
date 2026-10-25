import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { BIKE_TYPES, type BikeType } from '../domain.ts';
import { BadRequestError, NotFoundError } from '../errors.ts';
import { pathLengthM } from '../geo/geo.ts';
import { listRouteRows } from '../matching/routeRepo.ts';
import { parseFit } from '../parsers/fit.ts';
import { parseGpx } from '../parsers/gpx.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import * as rides from '../rides/repo.ts';
import { bikeTypeFilter, parse, safeJson, upload } from './http.ts';

const idParam = z.object({ id: z.string().min(1) });

const listQuery = z.object({ bike_type: bikeTypeFilter, route_id: z.string().optional() });

const nearQuery = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radius_m: z.coerce.number().positive().max(500).default(30),
  bike_type: bikeTypeFilter,
});

const updateBody = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    notes: z.string().max(5000).nullable().optional(),
    bike_type: z.enum(BIKE_TYPES).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'No fields to update');

const boolString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((v) => v === 'true');

const importBody = z.object({
  /** Bike type for rides where none is detected. Empty = leave unassigned. */
  bike_type: z.enum([...BIKE_TYPES, '']).default(''),
  skip_non_cycling: boolString,
  use_detected_bike_type: boolString,
});

const routeBody = z.object({ route_id: z.string().min(1).nullable() });

function parseUpload(file: Express.Multer.File): ParsedActivity {
  return file.originalname.toLowerCase().endsWith('.fit')
    ? parseFit(new Uint8Array(file.buffer))
    : parseGpx(file.buffer.toString('utf-8'), file.originalname);
}

export function ridesRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const router = Router();

  const withRouteNames = (rows: rides.RideRow[]) => {
    const names = new Map(listRouteRows(db).map((r) => [r.id, r.name]));
    return rows.map((r) => ({
      ...r,
      route_name: r.route_id ? (names.get(r.route_id) ?? null) : null,
    }));
  };

  router.get('/', (req, res) => {
    const q = parse(listQuery, req.query);
    res.json(withRouteNames(rides.listRides(db, { bikeType: q.bike_type, routeId: q.route_id })));
  });

  router.get('/near-point', (req, res) => {
    const q = parse(nearQuery, req.query);
    res.json(
      withRouteNames(rides.ridesNear(db, q.lat, q.lng, q.radius_m, { bikeType: q.bike_type }))
    );
  });

  router.post('/preview', upload.array('files'), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError('No files provided');
    const previews = [];
    const errors = [];
    const seenStarts = new Set<number>();
    for (const file of files) {
      try {
        const parsed = parseUpload(file);
        const start = parsed.points.find((p) => p.time !== null)?.time ?? null;
        const duplicate =
          ctx.importer.findDuplicate(parsed) ??
          (start !== null && seenStarts.has(start)
            ? { title: '(another file in this upload)' }
            : undefined);
        if (start !== null) seenStarts.add(start);
        previews.push({
          filename: file.originalname,
          title: parsed.title,
          date: start !== null ? ctx.importer.localDate(start) : null,
          distance_km: Math.round((parsed.distanceM ?? pathLengthM(parsed.points)) / 10) / 100,
          activityType: parsed.activityType,
          isCycling: parsed.isCycling,
          detectedBikeType: parsed.detectedBikeType,
          isDuplicate: !!duplicate,
          duplicateOf: duplicate?.title ?? null,
          pointCount: parsed.points.length,
        });
      } catch (e) {
        errors.push({ filename: file.originalname, error: (e as Error).message });
      }
    }
    res.json({ previews, errors });
  });

  router.post('/', upload.array('files'), (req, res) => {
    const files = (req.files as Express.Multer.File[] | undefined) ?? [];
    if (files.length === 0) throw new BadRequestError('No files provided');
    const opts = parse(importBody, req.body);
    const imported = [];
    const skipped = [];
    const errors = [];
    for (const file of files) {
      try {
        const parsed = parseUpload(file);
        if (opts.skip_non_cycling && !parsed.isCycling && parsed.activityType !== 'unknown') {
          skipped.push({
            file: file.originalname,
            reason: `Non-cycling activity (${parsed.activityType})`,
          });
          continue;
        }
        const detected = opts.use_detected_bike_type ? parsed.detectedBikeType : null;
        const bikeType: BikeType | null = detected ?? (opts.bike_type || null);
        const result = ctx.importer.import(parsed, { source: 'gpx', bikeType });
        if (result.status === 'duplicate') {
          skipped.push({
            file: file.originalname,
            reason: `Already imported as "${result.existing.title ?? 'untitled'}" (${result.existing.date ?? 'no date'})`,
          });
        } else {
          imported.push(result.ride);
        }
      } catch (e) {
        errors.push({ file: file.originalname, error: (e as Error).message });
      }
    }
    if (imported.length > 0) ctx.nameRoutesInBackground();
    res.json({
      imported,
      skipped,
      errors,
      summary: {
        total: files.length,
        success: imported.length,
        skipped: skipped.length,
        failed: errors.length,
      },
    });
  });

  router.get('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const ride = rides.getRide(db, id);
    if (!ride) throw new NotFoundError('Ride not found');
    const track = rides.loadTrack(db, id) ?? [];
    const sections = db
      .prepare(`SELECT * FROM sections WHERE ride_id = ? ORDER BY created_at`)
      .all(id) as Array<
      Record<string, unknown> & { surface_tags: string | null; track_segment: string | null }
    >;
    const [withName] = withRouteNames([ride]);
    res.json({
      ...withName,
      track: track.map((p) => [p.lat, p.lng]),
      elevation: track.map((p) => p.ele),
      devices: rides.listDevices(db, id),
      sections: sections.map((s) => ({
        ...s,
        surface_tags: safeJson<string[]>(s.surface_tags, []),
        track_segment: safeJson<[number, number][] | null>(s.track_segment, null),
      })),
    });
  });

  const update = (req: import('express').Request, res: import('express').Response) => {
    const { id } = parse(idParam, req.params);
    const body = parse(updateBody, req.body);
    if (!rides.getRide(db, id)) throw new NotFoundError('Ride not found');
    rides.updateRide(db, id, { title: body.title, notes: body.notes, bikeType: body.bike_type });
    res.json(rides.getRide(db, id));
  };
  router.patch('/:id', update);
  router.put('/:id', update);

  router.delete('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const ride = rides.getRide(db, id);
    if (!ride) throw new NotFoundError('Ride not found');
    db.transaction(() => {
      rides.deleteRide(db, id);
      if (ride.route_id) ctx.routes.recenterRoute(ride.route_id);
    })();
    res.json({ success: true });
  });

  router.get('/:id/deviation', (req, res) => {
    const { id } = parse(idParam, req.params);
    const d = ctx.routes.deviation(id);
    const toPairs = (runs: Array<Array<{ lat: number; lng: number }>>) =>
      runs.map((run) => run.map((p) => [p.lat, p.lng]));
    res.json({ ...d, detours: toPairs(d.detours), skipped: toPairs(d.skipped) });
  });

  router.put('/:id/route', (req, res) => {
    const { id } = parse(idParam, req.params);
    const { route_id } = parse(routeBody, req.body);
    const routeId = ctx.routes.moveRide(id, route_id);
    ctx.nameRoutesInBackground();
    res.json({ route_id: routeId });
  });

  return router;
}
