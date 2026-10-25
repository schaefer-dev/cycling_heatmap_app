import { backgroundNamer, createApp } from './app.ts';
import { bootstrap } from './bootstrap.ts';
import { loadConfig } from './config.ts';
import { logger } from './logger.ts';
import { startSyncScheduler } from './sync/scheduler.ts';

const config = loadConfig();
const services = await bootstrap(config);

const schedulers = {
  garmin:
    services.garminSync && config.garmin.syncIntervalMin > 0
      ? startSyncScheduler(services.garminSync, config.garmin.syncIntervalMin)
      : null,
  // Offset from the Garmin run so the two syncs rarely compete for the database.
  hammerhead:
    services.hammerheadSync && config.hammerhead && config.hammerhead.syncIntervalMin > 0
      ? startSyncScheduler(services.hammerheadSync, config.hammerhead.syncIntervalMin, 90_000)
      : null,
};

const nameRoutes = backgroundNamer(services.routes);
const app = createApp({
  ...services,
  schedulers,
  nameRoutesInBackground: () => void nameRoutes(),
});

const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});

// Name any routes left unnamed (first start, or geocoder was unreachable last time).
void nameRoutes();

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  schedulers.garmin?.stop();
  schedulers.hammerhead?.stop();
  server.close(() => {
    services.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
