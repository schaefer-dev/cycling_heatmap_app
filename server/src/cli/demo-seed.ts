/**
 * npm run demo:seed
 * Fills data/demo.db (or DB_PATH) with the synthetic demo dataset (rides around Girona) so Ridestack
 * can be tried without a Garmin or Hammerhead account: DB_PATH=./data/demo.db npm run dev
 * Refuses to touch a database that already has rides.
 */
import { bootstrap } from '../bootstrap.ts';
import { loadConfig } from '../config.ts';
import { seedDemo } from '../demo/seed.ts';

const config = loadConfig({ DB_PATH: 'data/demo.db', ...process.env });
const services = await bootstrap({
  ...config,
  garmin: { ...config.garmin, apiKey: undefined },
  hammerhead: null,
});
console.log('Importing demo rides (and naming routes via OpenStreetMap, ~1 request/s)...');
try {
  const result = await seedDemo(services);
  console.log(`${result.rides} demo rides → ${result.routes} routes in ${config.dbPath}`);
  console.log(`Start the app on it with: DB_PATH=${config.dbPath} npm run dev`);
} catch (err) {
  console.error(
    `Not seeding ${config.dbPath}: ${(err as Error).message}. Demo data only goes into an empty ` +
      `database (delete data/demo.db to start over).`
  );
  process.exitCode = 1;
}
services.db.close();
