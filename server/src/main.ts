import { backgroundNamer, createApp } from './app.ts';
import { bootstrap } from './bootstrap.ts';
import { loadConfig } from './config.ts';
import { startSyncScheduler } from './garmin/scheduler.ts';
import { logger } from './logger.ts';

const config = loadConfig();
const services = await bootstrap(config);

const scheduler =
  services.garminSync && config.garmin.syncIntervalMin > 0
    ? startSyncScheduler(services.garminSync, config.garmin.syncIntervalMin)
    : null;

const nameRoutes = backgroundNamer(services.routes);
const app = createApp({
  ...services,
  scheduler,
  nameRoutesInBackground: () => void nameRoutes(),
});

const server = app.listen(config.port, () => {
  logger.info(`API listening on http://localhost:${config.port}`);
});

// Name any routes left unnamed (first start, or geocoder was unreachable last time).
void nameRoutes();

function shutdown(signal: string) {
  logger.info(`${signal} received, shutting down`);
  scheduler?.stop();
  server.close(() => {
    services.db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
