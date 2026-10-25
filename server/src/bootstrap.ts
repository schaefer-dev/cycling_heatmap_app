/** Wires the real dependencies together (shared by the server and the CLI commands). */
import type { Config } from './config.ts';
import { openDatabase, type DB } from './db/connection.ts';
import { migrate } from './db/migrate.ts';
import { createGarminClient } from './garmin/client.ts';
import { GarminSync } from './garmin/sync.ts';
import { dbTokenStore } from './hammerhead/auth.ts';
import { createHammerheadClient, type HammerheadOAuth } from './hammerhead/client.ts';
import { HammerheadSync } from './hammerhead/sync.ts';
import { logger } from './logger.ts';
import { createNominatimGeocoder, nullGeocoder } from './matching/geocoder.ts';
import { RouteService } from './matching/routeService.ts';
import { RideImporter, ensureDerivedData } from './rides/importService.ts';
import { closeStaleRuns } from './sync/runs.ts';

export interface Services {
  db: DB;
  routes: RouteService;
  importer: RideImporter;
  garminSync: GarminSync | null;
  hammerheadSync: HammerheadSync | null;
  hammerheadAuth: HammerheadOAuth | null;
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

  let hammerheadSync: HammerheadSync | null = null;
  let hammerheadAuth: HammerheadOAuth | null = null;
  if (config.hammerhead) {
    const tokens = dbTokenStore(db);
    const client = createHammerheadClient({ ...config.hammerhead, tokens });
    hammerheadAuth = client;
    hammerheadSync = new HammerheadSync({
      db,
      api: client,
      tokens,
      importer,
      routes,
      fitDir: config.fitDir,
    });
    if (!hammerheadSync.isConnected()) {
      logger.info('Hammerhead not connected yet: use "Connect Hammerhead" in the UI');
    }
  } else {
    logger.warn('HAMMERHEAD_CLIENT_ID/HAMMERHEAD_CLIENT_SECRET not set: Hammerhead sync disabled');
  }

  return { db, routes, importer, garminSync, hammerheadSync, hammerheadAuth };
}
