/**
 * Planned-route name suggestions for route groups. GET only computes the list; names and links
 * change exclusively through the explicit accept / reject / unlink calls below.
 */
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { BadRequestError, ConflictError } from '../errors.ts';
import { plannedRoutesStatus } from '../hammerhead/plannedRoutes.ts';
import * as plannedRepo from '../matching/plannedRepo.ts';
import { isRatedRouteName, suggestPlannedNames } from '../matching/plannedSuggestions.ts';
import { parse } from './http.ts';

const listQuery = z.object({
  include_weak: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});
const decisionBody = z.object({
  route_id: z.string().min(1),
  planned_route_id: z.string().min(1),
  score: z.number().min(0).max(1).optional(),
});
const routeParam = z.object({ routeId: z.string().min(1) });

export function suggestionsRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const router = Router();

  router.get('/', (req, res) => {
    const { include_weak } = parse(listQuery, req.query);
    const groups = plannedRepo.groupStats(db);
    const planned = plannedRepo.plannedForSuggestions(db);
    const decisions = plannedRepo.decisions(db);
    const all = suggestPlannedNames(groups, planned, decisions, { includeWeak: true });
    const strong = all.filter((s) => s.candidates[0]!.strength === 'strong');
    const shown = include_weak
      ? all
      : suggestPlannedNames(groups, planned, decisions, { includeWeak: false });
    res.json({
      planned_routes: {
        ...plannedRoutesStatus(db),
        rated: planned.filter((p) => !p.deleted && isRatedRouteName(p.name)).length,
      },
      counts: { strong: strong.length, weak: all.length - strong.length },
      groups: shown.map(({ group, candidates }) => ({
        route: {
          id: group.routeId,
          name: group.name,
          name_source: group.nameSource,
          ride_count: group.rideCount,
          distance_km: Math.round(group.distanceKm * 10) / 10,
          elevation_gain_m: group.elevationGainM !== null ? Math.round(group.elevationGainM) : null,
          first_ridden: group.firstRidden,
          last_ridden: group.lastRidden,
        },
        candidates: candidates.map((c) => ({
          planned_route_id: c.plannedRouteId,
          name: c.name,
          distance_km: c.distanceKm,
          gain_m: c.gainM,
          created_at: c.createdAt,
          score: c.score,
          strength: c.strength,
          distance_diff: c.distanceDiff,
          lag_days: c.lagDays,
          reasons: c.reasons,
          other_groups: c.otherGroups,
        })),
      })),
    });
  });

  /** Re-reads the Hammerhead route library (names, distances); changes no route. */
  router.post('/refresh', async (_req, res) => {
    const sync = ctx.hammerheadSync;
    if (!sync?.isConnected()) throw new BadRequestError('Hammerhead is not connected');
    if (sync.isRunning) throw new ConflictError('A Hammerhead sync is running');
    const result = await sync.refreshPlannedRoutes();
    res.json({ ...result, planned_routes: plannedRoutesStatus(db) });
  });

  router.post('/accept', (req, res) => {
    const body = parse(decisionBody, req.body);
    const name = ctx.routes.acceptPlannedName(body.route_id, body.planned_route_id, body.score);
    res.json({ route_id: body.route_id, name });
  });

  router.post('/reject', (req, res) => {
    const body = parse(decisionBody, req.body);
    ctx.routes.rejectPlannedName(body.route_id, body.planned_route_id, body.score);
    res.json({ rejected: true });
  });

  router.delete('/links/:routeId', (req, res) => {
    const { routeId } = parse(routeParam, req.params);
    ctx.routes.unlinkPlannedRoute(routeId);
    res.json({ unlinked: true });
  });

  return router;
}
