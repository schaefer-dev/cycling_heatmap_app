/** HTTP API for route groups ("routes" in the cycling sense, not Express routes). */
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { NotFoundError } from '../errors.ts';
import * as routeRepo from '../matching/routeRepo.ts';
import { listRides, loadDisplayLine } from '../rides/repo.ts';
import { bikeTypeFilter, parse } from './http.ts';

const idParam = z.object({ id: z.string().min(1) });
const listQuery = z.object({ bike_type: bikeTypeFilter });
const renameBody = z.object({ name: z.string().trim().min(1).max(120) });
const mergeBody = z.object({ into: z.string().min(1) });

export function routesRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const router = Router();

  router.get('/', (req, res) => {
    const q = parse(listQuery, req.query);
    res.json(routeRepo.listRouteSummaries(db, { bikeType: q.bike_type }));
  });

  router.post('/rebuild', (_req, res) => {
    const result = ctx.routes.rebuild();
    ctx.nameRoutesInBackground();
    res.json(result);
  });

  router.get('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const summary = routeRepo.getRouteSummary(db, id);
    if (!summary) throw new NotFoundError('Route not found');
    const reference = summary.reference_ride_id
      ? loadDisplayLine(db, summary.reference_ride_id)
      : null;
    res.json({
      ...summary,
      reference_track: reference?.map((p) => [p.lat, p.lng]) ?? null,
      rides: listRides(db, { routeId: id }),
    });
  });

  /** Simplified tracks of every ride on the route, for drawing them together. */
  router.get('/:id/tracks', (req, res) => {
    const { id } = parse(idParam, req.params);
    if (!routeRepo.getRoute(db, id)) throw new NotFoundError('Route not found');
    res.json(
      listRides(db, { routeId: id }).map((r) => ({
        id: r.id,
        date: r.date,
        track: loadDisplayLine(db, r.id)?.map((p) => [p.lat, p.lng]) ?? [],
      }))
    );
  });

  router.patch('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const { name } = parse(renameBody, req.body);
    ctx.routes.rename(id, name);
    res.json(routeRepo.getRouteSummary(db, id));
  });

  router.post('/:id/merge', (req, res) => {
    const { id } = parse(idParam, req.params);
    const { into } = parse(mergeBody, req.body);
    ctx.routes.mergeRoutes(id, into);
    ctx.nameRoutesInBackground();
    res.json(routeRepo.getRouteSummary(db, into));
  });

  return router;
}
