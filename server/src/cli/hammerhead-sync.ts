/**
 * npm run hammerhead:sync [-- --backfill] [-- --dry-run]
 * Runs one Hammerhead sync in the foreground. Stop the server first (or use "Sync now" in the UI).
 * Connect the account once via "Connect Hammerhead" in the UI before using this.
 * A dry run downloads and checks every new activity (link / import / skip) without writing anything.
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
if (!services.hammerheadSync) {
  console.error('HAMMERHEAD_CLIENT_ID / HAMMERHEAD_CLIENT_SECRET are not set in .env');
  process.exit(1);
}
if (!services.hammerheadSync.isConnected()) {
  console.error('Hammerhead is not connected: use "Connect Hammerhead" in the UI first');
  process.exit(1);
}
const summary = await services.hammerheadSync.run({
  mode: values.backfill ? 'backfill' : 'incremental',
  dryRun: values['dry-run'],
});
if (summary.dryRun) {
  for (const p of summary.plan) {
    console.log(
      `${p.start}  ${p.action.padEnd(6)}  ${String(p.activityId).padEnd(28)} ${p.name ?? ''}  ${p.detail ?? ''}`
    );
  }
}
console.log(
  `\n${summary.dryRun ? 'Would import' : 'Imported'}: ${summary.imported}, linked: ${summary.linked}, skipped: ${summary.skipped}, failed: ${summary.failed}`
);
services.db.close();
