import type { Statement } from 'better-sqlite3';
import type { DB } from './connection.ts';

const cache = new WeakMap<DB, Map<string, Statement>>();

/** Prepared statement cached per connection, so repositories can stay plain functions. */
export function stmt(db: DB, sql: string): Statement {
  let perDb = cache.get(db);
  if (!perDb) {
    perDb = new Map();
    cache.set(db, perDb);
  }
  let s = perDb.get(sql);
  if (!s) {
    s = db.prepare(sql);
    perDb.set(sql, s);
  }
  return s;
}
