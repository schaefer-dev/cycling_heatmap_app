import fs from 'node:fs';
import path from 'node:path';
import type { DB } from './connection.ts';
import { logger } from '../logger.ts';
import { migrations } from './migrations/index.ts';

export interface Migration {
  version: number;
  name: string;
  up(db: DB): void;
  /** Run VACUUM after this migration (e.g. after dropping large tables). */
  vacuum?: boolean;
}

export function currentVersion(db: DB): number {
  return db.pragma('user_version', { simple: true }) as number;
}

/**
 * Applies pending migrations in order, each in its own transaction, and records progress in
 * PRAGMA user_version. For file databases a backup is written to `backupDir` before anything runs.
 */
export async function migrate(
  db: DB,
  opts: { backupDir?: string; list?: readonly Migration[] } = {}
): Promise<number[]> {
  const list = opts.list ?? migrations;
  const from = currentVersion(db);
  const pending = list.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  if (pending.length === 0) return [];

  if (opts.backupDir && db.name !== ':memory:') {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(opts.backupDir, `pre-migration-v${from}-${stamp}.db`);
    logger.info(`Backing up database to ${target} before ${pending.length} migration(s)`);
    fs.mkdirSync(opts.backupDir, { recursive: true });
    await db.backup(target);
  }

  let needsVacuum = false;
  for (const m of pending) {
    const started = Date.now();
    db.transaction(() => {
      m.up(db);
      db.pragma(`user_version = ${m.version}`);
    })();
    needsVacuum ||= !!m.vacuum;
    logger.info(`Migration ${m.version} (${m.name}) applied in ${Date.now() - started} ms`);
  }
  if (needsVacuum) db.exec('VACUUM');
  return pending.map((m) => m.version);
}
