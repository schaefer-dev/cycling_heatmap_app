import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { BadRequestError, ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import { lastSyncRuns } from '../garmin/sync.ts';
import { parse } from './http.ts';

const runBody = z.object({ mode: z.enum(['incremental', 'backfill']).default('incremental') });

export function syncRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const runs = lastSyncRuns(ctx.db, 10);
    const counts = ctx.db
      .prepare(`SELECT status, COUNT(*) AS n FROM garmin_activities GROUP BY status`)
      .all() as Array<{ status: string; n: number }>;
    res.json({
      configured: ctx.garminSync !== null,
      running: ctx.garminSync?.isRunning ?? false,
      next_run_at: ctx.scheduler?.nextRunAt()?.toISOString() ?? null,
      last_run: runs[0] ?? null,
      last_success_at: runs.find((r) => r.status === 'success')?.finished_at ?? null,
      recent_runs: runs,
      activities: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    });
  });

  /** Starts a sync in the background; poll /status for the result. */
  router.post('/garmin', (req, res) => {
    const { mode } = parse(runBody, req.body ?? {});
    const sync = ctx.garminSync;
    if (!sync)
      throw new BadRequestError('Garmin sync is not configured: set GARMIN_API_KEY in .env');
    if (sync.isRunning) throw new ConflictError('A Garmin sync is already running');
    sync.run({ mode }).catch((e: Error) => logger.error(`Garmin sync failed: ${e.message}`));
    res.status(202).json({ started: true, mode });
  });

  return router;
}
