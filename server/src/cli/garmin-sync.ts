/**
 * npm run garmin:sync [-- --backfill] [-- --dry-run]
 * Runs one Garmin sync in the foreground. Stop the server first (or use "Sync now" in the UI).
 */
import { parseArgs } from 'node:util';
import { bootstrap } from '../bootstrap.ts';
import { loadConfig } from '../config.ts';

const { values } = parseArgs({
  options: {
    backfill: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

const services = await bootstrap(loadConfig());
if (!services.garminSync) {
  console.error('GARMIN_API_KEY is not set in .env');
  process.exit(1);
}
const summary = await services.garminSync.run({
  mode: values.backfill ? 'backfill' : 'incremental',
  dryRun: values['dry-run'],
});
if (summary.dryRun) {
  for (const p of summary.plan) {
    console.log(
      `${p.start}  ${p.action.padEnd(6)}  ${String(p.activityId).padEnd(12)} ${p.name ?? ''}  ${p.detail ?? ''}`
    );
  }
}
console.log(
  `\n${summary.dryRun ? 'Would import' : 'Imported'}: ${summary.imported}, linked: ${summary.linked}, skipped: ${summary.skipped}, failed: ${summary.failed}`
);
services.db.close();
