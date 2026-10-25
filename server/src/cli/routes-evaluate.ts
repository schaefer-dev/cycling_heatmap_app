/**
 * npm run routes:evaluate [-- --save]
 *
 * Runs the clustering on the current database WITHOUT writing anything and prints the groups. With
 * a saved snapshot (data/route-snapshot.json) it also prints what changed, which is the regression
 * check when tuning thresholds or changing the matcher. --save writes a new snapshot.
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { loadConfig } from '../config.ts';
import { openDatabase } from '../db/connection.ts';
import { currentVersion } from '../db/migrate.ts';
import { migrations } from '../db/migrations/index.ts';
import { clusterRides } from '../matching/clustering.ts';
import { getRide, loadAllShapes } from '../rides/repo.ts';

const { values } = parseArgs({ options: { save: { type: 'boolean', default: false } } });
const config = loadConfig();
const db = openDatabase(config.dbPath);
if (currentVersion(db) < migrations.length) {
  console.error('Database is not migrated yet; start the server once first.');
  process.exit(1);
}

const started = Date.now();
const shapes = loadAllShapes(db);
const clusters = clusterRides(shapes, config.matching);
const ms = Date.now() - started;

const label = (id: string) => {
  const r = getRide(db, id);
  return `${r?.date ?? '????-??-??'}  ${(r?.distance_km ?? 0).toFixed(1).padStart(6)} km  ${r?.title ?? ''}`;
};

const multi = clusters
  .filter((c) => c.members.length > 1)
  .sort((a, b) => b.members.length - a.members.length);
for (const c of multi) {
  console.log(`\n■ ${c.members.length} rides — reference: ${label(c.referenceId)}`);
  for (const m of c.members) {
    console.log(
      `   ${(m.score * 100).toFixed(0).padStart(3)}% ${m.direction === 'reverse' ? '↺' : ' '} ${label(m.rideId)}`
    );
  }
}
console.log(
  `\n${shapes.length} rides → ${clusters.length} routes (${multi.length} ridden more than once, ${clusters.length - multi.length} single) in ${ms} ms`
);

// Snapshot diff: compare as sets of ride-id groups.
const snapshotPath = path.join(config.dataDir, 'route-snapshot.json');
const groups = clusters.map((c) => c.members.map((m) => m.rideId).sort());
const canon = (g: string[]) => g.join(',');
if (fs.existsSync(snapshotPath)) {
  const previous = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8')) as string[][];
  const prevSet = new Set(previous.map(canon));
  const nowSet = new Set(groups.map(canon));
  const removed = previous.filter((g) => !nowSet.has(canon(g)));
  const added = groups.filter((g) => !prevSet.has(canon(g)));
  console.log(`\nVs. snapshot: ${added.length} new/changed groups, ${removed.length} gone`);
  for (const g of added) console.log(`  + [${g.map((id) => getRide(db, id)?.date).join(', ')}]`);
  for (const g of removed)
    console.log(`  - [${g.map((id) => getRide(db, id)?.date ?? 'deleted').join(', ')}]`);
}
if (values.save) {
  fs.writeFileSync(snapshotPath, JSON.stringify(groups, null, 1));
  console.log(`Snapshot saved to ${snapshotPath}`);
}
db.close();
