import compression from 'compression';
import express from 'express';
import { errorHandler } from './api/http.ts';
import { heatmapRouter } from './api/heatmap.ts';
import { ridesRouter } from './api/rides.ts';
import { routesRouter } from './api/routes.ts';
import { sectionsRouter } from './api/sections.ts';
import { syncRouter } from './api/sync.ts';
import type { DB } from './db/connection.ts';
import { hammerheadRouter } from './api/hammerhead.ts';
import type { GarminSync } from './garmin/sync.ts';
import { OAuthStates } from './hammerhead/auth.ts';
import type { HammerheadOAuth } from './hammerhead/client.ts';
import type { HammerheadSync } from './hammerhead/sync.ts';
import { logger } from './logger.ts';
import type { RouteService } from './matching/routeService.ts';
import type { RideImporter } from './rides/importService.ts';
import type { Scheduler } from './sync/scheduler.ts';

/** Everything request handlers need. Built in main.ts (or by tests with fakes). */
export interface AppContext {
  db: DB;
  routes: RouteService;
  importer: RideImporter;
  garminSync: GarminSync | null;
  hammerheadSync: HammerheadSync | null;
  hammerheadAuth: HammerheadOAuth | null;
  schedulers: { garmin: Scheduler | null; hammerhead: Scheduler | null };
  /** Fire-and-forget route naming (geocoding is slow and must not block requests). */
  nameRoutesInBackground(): void;
}

/** Runs `routes.nameRoutes()` at most once at a time; calls during a run trigger one re-run. */
export function backgroundNamer(routes: RouteService): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const run = async (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await routes.nameRoutes();
        } catch (e) {
          logger.warn(`Route naming failed: ${(e as Error).message}`);
        }
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };
  return run;
}

export function createApp(ctx: AppContext): express.Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(compression()); // map payloads are large JSON arrays; gzip shrinks them ~4x
  app.use(express.json({ limit: '5mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });
  app.use('/api/rides', ridesRouter(ctx));
  app.use('/api/routes', routesRouter(ctx));
  app.use('/api/sections', sectionsRouter(ctx));
  app.use('/api/heatmap', heatmapRouter(ctx));
  app.use('/api/sync', syncRouter(ctx));
  app.use('/api/hammerhead', hammerheadRouter(ctx, new OAuthStates()));
  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Unknown API endpoint' });
  });
  app.use(errorHandler);
  return app;
}
