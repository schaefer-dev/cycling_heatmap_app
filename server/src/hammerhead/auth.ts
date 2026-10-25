/** Persistence for the connected Hammerhead account, and OAuth `state` values in flight. */
import { randomBytes } from 'node:crypto';
import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { StoredTokens, TokenStore } from './client.ts';

/** Single-row table: this archive belongs to one rider. */
export function dbTokenStore(db: DB): TokenStore {
  return {
    load() {
      const row = stmt(
        db,
        `SELECT access_token, refresh_token, expires_at, user_id FROM hammerhead_auth WHERE id = 1`
      ).get() as
        | {
            access_token: string;
            refresh_token: string;
            expires_at: number;
            user_id: string | null;
          }
        | undefined;
      return row
        ? {
            accessToken: row.access_token,
            refreshToken: row.refresh_token,
            expiresAt: row.expires_at,
            userId: row.user_id,
          }
        : null;
    },
    save(t: StoredTokens) {
      stmt(
        db,
        `INSERT INTO hammerhead_auth (id, user_id, access_token, refresh_token, expires_at)
         VALUES (1, @userId, @accessToken, @refreshToken, @expiresAt)
         ON CONFLICT(id) DO UPDATE SET user_id = excluded.user_id,
           access_token = excluded.access_token, refresh_token = excluded.refresh_token,
           expires_at = excluded.expires_at`
      ).run(t);
    },
    clear() {
      stmt(db, `DELETE FROM hammerhead_auth`).run();
    },
  };
}

export function connectedAt(db: DB): string | null {
  const row = stmt(db, `SELECT connected_at FROM hammerhead_auth WHERE id = 1`).get() as
    { connected_at: string } | undefined;
  return row?.connected_at ?? null;
}

const STATE_TTL_MS = 10 * 60_000;

/** Random, single-use, short-lived values that tie an OAuth redirect to the request that began it. */
export class OAuthStates {
  #states = new Map<string, number>();
  #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  create(): string {
    const t = this.#now();
    for (const [s, created] of this.#states) {
      if (t - created > STATE_TTL_MS) this.#states.delete(s);
    }
    const state = randomBytes(24).toString('base64url');
    this.#states.set(state, t);
    return state;
  }

  /** True once for a state issued less than 10 minutes ago. */
  consume(state: string): boolean {
    const created = this.#states.get(state);
    this.#states.delete(state);
    return created !== undefined && this.#now() - created <= STATE_TTL_MS;
  }
}
