/**
 * Garmin Connect Personal API client (read-only).
 *
 * Auth: the personal API key (Garmin Connect → Settings → Personal API token) is exchanged for a
 * 24 h bearer token. There are no refresh tokens; we simply exchange again. The key never leaves
 * the server and is never logged.
 *
 * Requests are sequential, throttled, and retried with backoff on 429/5xx/network errors.
 */
import { logger } from '../logger.ts';

export const DEFAULT_GARMIN_BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';

export interface GarminActivitySummary {
  activityId: number;
  activityName: string | null;
  /** "YYYY-MM-DD HH:mm:ss" in UTC. */
  startTimeGMT: string;
  startTimeLocal?: string;
  activityType: { typeKey: string };
  distance?: number;
  duration?: number;
  elapsedDuration?: number;
  movingDuration?: number;
  elevationGain?: number;
}

export interface GarminApi {
  listActivities(start: number, limit: number): Promise<GarminActivitySummary[]>;
  /** ZIP archive containing the original FIT file. */
  downloadActivity(activityId: number): Promise<Uint8Array>;
}

/** The key is missing, wrong, revoked or expired. Retrying will not help. */
export class GarminAuthError extends Error {}

export class GarminHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface GarminClientOptions {
  apiKey: string;
  baseUrl?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
}

export function parseGarminGmt(value: string): number {
  return Date.parse(`${value.replace(' ', 'T')}Z`);
}

export function createGarminClient(opts: GarminClientOptions): GarminApi {
  const baseUrl = opts.baseUrl ?? DEFAULT_GARMIN_BASE_URL;
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 1000;
  const maxRetries = opts.maxRetries ?? 4;

  let token: { value: string; expiresAt: number } | null = null;
  let lastRequestAt = 0;

  async function throttled(url: string, init: RequestInit): Promise<Response> {
    const wait = lastRequestAt + minInterval - now();
    if (wait > 0) await sleep(wait);
    lastRequestAt = now();
    return fetchFn(url, init);
  }

  /** Retries transient failures (network, 429, 5xx) with exponential backoff / Retry-After. */
  async function withRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      let res: Response | null = null;
      let networkError: unknown = null;
      try {
        res = await throttled(url, init);
      } catch (e) {
        networkError = e;
      }
      const transient =
        networkError !== null || (res !== null && (res.status === 429 || res.status >= 500));
      if (!transient) return res!;
      if (attempt >= maxRetries) {
        if (networkError) throw networkError;
        return res!;
      }
      const retryAfter = Number(res?.headers.get('retry-after'));
      const delay =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(60_000, 1000 * 2 ** attempt);
      logger.warn(
        `Garmin request failed (${networkError ? 'network error' : `HTTP ${res!.status}`}), retrying in ${delay} ms`
      );
      await sleep(delay);
    }
  }

  async function getToken(force = false): Promise<string> {
    if (!force && token && token.expiresAt - now() > 5 * 60_000) return token.value;
    // Note: sending "Accept: application/json" makes this endpoint answer 406; the body is a raw JWT.
    const res = await withRetry(`${baseUrl}${TOKEN_PATH}`, {
      method: 'POST',
      headers: { Authorization: `ApiKey ${opts.apiKey}` },
    });
    if (res.status === 401 || res.status === 403) {
      throw new GarminAuthError(
        'Garmin rejected the API key (invalid or expired). Create a new key in Garmin Connect → Settings → Personal API token and update GARMIN_API_KEY.'
      );
    }
    if (!res.ok)
      throw new GarminHttpError(res.status, `Garmin token exchange failed: HTTP ${res.status}`);
    let value = (await res.text()).trim();
    if (value.startsWith('"')) value = JSON.parse(value) as string;
    token = { value, expiresAt: jwtExpiry(value) ?? now() + 23 * 3600_000 };
    return value;
  }

  async function authorizedGet(path: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await getToken(attempt > 0);
      const res = await withRetry(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${bearer}` },
      });
      if (res.status === 401 && attempt === 0) continue; // token revoked/expired early: exchange again
      if (res.status === 401 || res.status === 403) {
        throw new GarminAuthError(
          `Garmin denied access to ${path.split('?')[0]} (HTTP ${res.status})`
        );
      }
      if (!res.ok)
        throw new GarminHttpError(
          res.status,
          `Garmin request ${path.split('?')[0]} failed: HTTP ${res.status}`
        );
      return res;
    }
    throw new GarminAuthError('Garmin authentication failed');
  }

  return {
    async listActivities(start, limit) {
      const qs = new URLSearchParams({ start: String(start), limit: String(limit) });
      const res = await authorizedGet(`/activitylist-service/activities/search/activities?${qs}`);
      return (await res.json()) as GarminActivitySummary[];
    },
    async downloadActivity(activityId) {
      const res = await authorizedGet(`/download-service/files/activity/${activityId}`);
      return new Uint8Array(await res.arrayBuffer());
    },
  };
}

function jwtExpiry(jwt: string): number | null {
  try {
    const payload = JSON.parse(Buffer.from(jwt.split('.')[1] ?? '', 'base64url').toString()) as {
      exp?: number;
    };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}
