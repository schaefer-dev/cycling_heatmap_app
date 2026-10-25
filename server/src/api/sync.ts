import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import type { DB } from '../db/connection.ts';
import type { Provider } from '../domain.ts';
import { BadRequestError, ConflictError } from '../errors.ts';
import { logger } from '../logger.ts';
import { connectedAt } from '../hammerhead/auth.ts';
import { lastSyncRuns } from '../sync/runs.ts';
import type { Scheduler } from '../sync/scheduler.ts';
import { parse } from './http.ts';

const runBody = z.object({ mode: z.enum(['incremental', 'backfill']).default('incremental') });

const ACTIVITY_TABLES: Record<Provider, string> = {
  garmin: 'garmin_activities',
  hammerhead: 'hammerhead_activities',
};

function providerStatus(
  db: DB,
  provider: Provider,
  sync: { isRunning: boolean } | null,
  scheduler: Scheduler | null
) {
  const runs = lastSyncRuns(db, provider, 10);
  const counts = db
    .prepare(`SELECT status, COUNT(*) AS n FROM ${ACTIVITY_TABLES[provider]} GROUP BY status`)
    .all() as Array<{ status: string; n: number }>;
  return {
    configured: sync !== null,
    running: sync?.isRunning ?? false,
    next_run_at: scheduler?.nextRunAt()?.toISOString() ?? null,
    last_run: runs[0] ?? null,
    last_success_at: runs.find((r) => r.status === 'success')?.finished_at ?? null,
    recent_runs: runs,
    activities: Object.fromEntries(counts.map((c) => [c.status, c.n])),
  };
}

export function syncRouter(ctx: AppContext): Router {
  const router = Router();

  router.get('/status', (_req, res) => {
    const hammerheadConnected = ctx.hammerheadSync?.isConnected() ?? false;
    res.json({
      garmin: providerStatus(ctx.db, 'garmin', ctx.garminSync, ctx.schedulers.garmin),
      hammerhead: {
        ...providerStatus(ctx.db, 'hammerhead', ctx.hammerheadSync, ctx.schedulers.hammerhead),
        connected: hammerheadConnected,
        connected_at: hammerheadConnected ? connectedAt(ctx.db) : null,
      },
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

  router.post('/hammerhead', (req, res) => {
    const { mode } = parse(runBody, req.body ?? {});
    const sync = ctx.hammerheadSync;
    if (!sync)
      throw new BadRequestError(
        'Hammerhead sync is not configured: set HAMMERHEAD_CLIENT_ID and HAMMERHEAD_CLIENT_SECRET in .env'
      );
    if (!sync.isConnected()) throw new BadRequestError('Hammerhead is not connected yet');
    if (sync.isRunning) throw new ConflictError('A Hammerhead sync is already running');
    sync.run({ mode }).catch((e: Error) => logger.error(`Hammerhead sync failed: ${e.message}`));
    res.status(202).json({ started: true, mode });
  });

  return router;
}
