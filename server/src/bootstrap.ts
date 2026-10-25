/** Wires the real dependencies together (shared by the server and the CLI commands). */
import type { Config } from './config.ts';
import { openDatabase, type DB } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { createGarminClient } from './garmin/client.ts';
import { GarminSync, closeStaleRuns } from './garmin/sync.ts';
import { logger } from './logger.ts';
import { createNominatimGeocoder, nullGeocoder } from './matching/geocoder.ts';
import { RouteService } from './matching/routeService.ts';
import { RideImporter, ensureDerivedData } from './rides/importService.ts';

export interface Services {
  db: DB;
  routes: RouteService;
  importer: RideImporter;
  garminSync: GarminSync | null;
}

export async function bootstrap(config: Config): Promise<Services> {
  const db = openDatabase(config.dbPath);
  logger.info(`Database: ${config.dbPath}`);
  await migrate(db, { backupDir: config.backupDir });
  closeStaleRuns(db);

  const geocoder = config.geocoder.enabled
    ? createNominatimGeocoder(db, {
        baseUrl: config.geocoder.baseUrl,
        userAgent: config.geocoder.userAgent,
        language: config.geocoder.language,
      })
    : nullGeocoder;
  const routes = new RouteService(db, geocoder, config.matching);
  const importer = new RideImporter(db, routes, config.timeZone);

  const derived = ensureDerivedData(db, routes);
  if (derived.geometry || derived.routed) {
    logger.info(`Derived data: ${derived.geometry} geometries, ${derived.routed} rides routed`);
  }

  const garminSync = config.garmin.apiKey
    ? new GarminSync({
        db,
        api: createGarminClient({ apiKey: config.garmin.apiKey, baseUrl: config.garmin.baseUrl }),
        importer,
        routes,
        fitDir: config.fitDir,
      })
    : null;
  if (!garminSync) logger.warn('GARMIN_API_KEY not set: Garmin sync disabled');

  return { db, routes, importer, garminSync };
}
