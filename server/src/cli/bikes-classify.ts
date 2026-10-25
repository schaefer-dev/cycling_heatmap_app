/**
 * npm run bikes:classify [-- --apply]
 * Re-derives the bike type of Garmin/Hammerhead rides from their sensors (data/bike-sensors.json),
 * then the activity type, then the configured default. Without --apply it only lists the changes.
 * Bike types picked by hand are kept. Stop the server first.
 */
import { parseArgs } from 'node:util';
import { bootstrap } from '../bootstrap.ts';
import { loadConfig } from '../config.ts';
import { loadBikeSensorConfig } from '../rides/bikeSensors.ts';
import { reclassifyBikeTypes } from '../rides/reclassify.ts';

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } });

const config = loadConfig();
const bikeSensors = loadBikeSensorConfig(config.bikeSensorsPath);
if (bikeSensors.rules.length === 0) {
  console.error(
    `No sensor rules: create ${config.bikeSensorsPath} (see bike-sensors.example.json)`
  );
  process.exit(1);
}

const services = await bootstrap(config);
const { checked, changes } = reclassifyBikeTypes(services.db, bikeSensors, {
  apply: values.apply,
});

const totals = new Map<string, number>();
for (const c of changes) {
  console.log(
    `${c.date ?? '????-??-??'}  ${(c.from ?? 'unassigned').padEnd(10)} → ${c.to.padEnd(6)}  ${(c.title ?? c.rideId).slice(0, 40).padEnd(40)}  ${c.reason}`
  );
  const key = `${c.from ?? 'unassigned'} → ${c.to}`;
  totals.set(key, (totals.get(key) ?? 0) + 1);
}
console.log(
  `\n${checked} synced ride(s) checked, ${changes.length} ${values.apply ? 'changed' : 'would change'}:`
);
for (const [key, n] of [...totals].sort()) console.log(`  ${key}: ${n}`);
if (!values.apply && changes.length > 0) console.log('\nRun with -- --apply to write them.');
services.db.close();
