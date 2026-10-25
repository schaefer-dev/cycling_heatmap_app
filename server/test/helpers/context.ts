import { createApp, type AppContext } from '../../src/app.ts';
import { openDatabase, type DB } from '../../src/db/connection.ts';
import { migrate } from '../../src/db/migrate.ts';
import type { Geocoder } from '../../src/matching/geocoder.ts';
import { RouteService } from '../../src/matching/routeService.ts';
import { RideImporter } from '../../src/rides/importService.ts';

/** Geocoder that names places after the rounded coordinates, without any network access. */
export const fakeGeocoder: Geocoder = {
  placeName: async (lat, lng) => `Place ${lat.toFixed(2)}/${lng.toFixed(2)}`,
};

export async function testDb(): Promise<DB> {
  const db = openDatabase(':memory:');
  await migrate(db);
  return db;
}

export async function testContext(overrides: Partial<AppContext> = {}): Promise<AppContext> {
  const db = overrides.db ?? (await testDb());
  const routes = overrides.routes ?? new RouteService(db, fakeGeocoder);
  return {
    db,
    routes,
    importer: overrides.importer ?? new RideImporter(db, routes, 'Europe/Berlin'),
    garminSync: null,
    scheduler: null,
    nameRoutesInBackground: () => void routes.nameRoutes(),
    ...overrides,
  };
}

export async function testApp(overrides: Partial<AppContext> = {}) {
  const ctx = await testContext(overrides);
  return { ctx, app: createApp(ctx) };
}
