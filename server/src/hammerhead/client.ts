/**
 * Hammerhead (Karoo) API client (read-only, scopes `activity:read route:read`).
 *
 * Auth: OAuth 2.0 authorization code flow. The user connects once in the browser; the access and
 * refresh tokens are persisted through `TokenStore` and refreshed automatically (the refresh token
 * may rotate, so every refresh result is saved). Client secret and tokens are never logged.
 *
 * Requests are sequential, throttled, and retried with backoff on 429/5xx/network errors.
 * Spec: https://api.hammerhead.io/v1/docs/openapi.yml
 */
import { logger } from '../logger.ts';

export const DEFAULT_HAMMERHEAD_AUTH_URL = 'https://api.hammerhead.io/v1/auth';
export const DEFAULT_HAMMERHEAD_API_URL = 'https://api.hammerhead.io/v1/api';
/** Space separated; users may grant only some of them on the consent page. */
export const HAMMERHEAD_SCOPE = 'activity:read route:read';
export const MAX_PAGE_SIZE = 100;

export interface HammerheadActivitySummary {
  /** e.g. "1000.activity.abcd" */
  id: string;
  name: string | null;
  createdAt: string;
  duration?: number;
  distance?: number;
}

export interface HammerheadActivity extends HammerheadActivitySummary {
  activityType?: string;
  description?: string | null;
  updatedAt?: string;
}

/** A planned route in the user's Hammerhead library (made there or synced from e.g. Komoot). */
export interface HammerheadRouteSummary {
  /** e.g. "1000.route.abcd" */
  id: string;
  name: string | null;
  createdAt: string;
  distance?: number;
  gain?: number;
}

export interface HammerheadPage<T = HammerheadActivitySummary> {
  totalPages: number;
  currentPage: number;
  data: T[];
}

export interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** Epoch ms. */
  expiresAt: number;
  userId: string | null;
}

export interface TokenStore {
  load(): StoredTokens | null;
  save(tokens: StoredTokens): void;
  clear(): void;
}

export interface HammerheadApi {
  listActivities(page: number, perPage: number, startDate?: string): Promise<HammerheadPage>;
  getActivity(id: string): Promise<HammerheadActivity>;
  /** The original FIT file. */
  downloadFit(id: string): Promise<Uint8Array>;
  /** Needs the `route:read` scope (HammerheadScopeError otherwise). */
  listRoutes(page: number, perPage: number): Promise<HammerheadPage<HammerheadRouteSummary>>;
}

/** Unchecked GET for exploring undocumented endpoints (CLI only); never throws on HTTP errors. */
export interface HammerheadProbe {
  rawGet(path: string): Promise<{ status: number; contentType: string | null; body: Uint8Array }>;
}

export interface HammerheadOAuth {
  authorizeUrl(state: string): string;
  /** Exchanges the code from the OAuth redirect and stores the tokens. */
  exchangeCode(code: string): Promise<StoredTokens>;
  /** Revokes access at Hammerhead (best effort) and forgets the tokens. */
  disconnect(): Promise<void>;
}

/** Not connected, or the connection was revoked/expired. The user has to (re)connect. */
export class HammerheadAuthError extends Error {}

/**
 * The login works but lacks a permission (e.g. `route:read` for planned routes, when the account
 * was connected before that scope was requested, or the user unticked it). Fixed by reconnecting.
 */
export class HammerheadScopeError extends Error {}

export class HammerheadHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface HammerheadClientOptions {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  tokens: TokenStore;
  authUrl?: string;
  apiUrl?: string;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  minIntervalMs?: number;
  maxRetries?: number;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  user_id?: string | number;
}

export function createHammerheadClient(
  opts: HammerheadClientOptions
): HammerheadApi & HammerheadOAuth & HammerheadProbe {
  const authUrl = opts.authUrl ?? DEFAULT_HAMMERHEAD_AUTH_URL;
  const apiUrl = opts.apiUrl ?? DEFAULT_HAMMERHEAD_API_URL;
  const fetchFn = opts.fetchFn ?? fetch;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = opts.now ?? Date.now;
  const minInterval = opts.minIntervalMs ?? 500;
  const maxRetries = opts.maxRetries ?? 4;

  let lastRequestAt = 0;
  /** Concurrent callers share one refresh (a rotated refresh token is single-use). */
  let refreshing: Promise<string> | null = null;

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
        `Hammerhead request failed (${networkError ? 'network error' : `HTTP ${res!.status}`}), retrying in ${delay} ms`
      );
      await sleep(delay);
    }
  }

  async function tokenRequest(params: Record<string, string>): Promise<StoredTokens> {
    const res = await withRetry(`${authUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: opts.clientId,
        client_secret: opts.clientSecret,
        ...params,
      }).toString(),
    });
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      // Hammerhead answers a wrong client secret and a bad code alike (401 invalid_auth_request).
      throw new HammerheadAuthError(
        params.grant_type === 'refresh_token'
          ? `Hammerhead rejected the stored login (HTTP ${res.status}): connect Hammerhead again`
          : `Hammerhead rejected the code exchange (HTTP ${res.status}): check HAMMERHEAD_CLIENT_ID / HAMMERHEAD_CLIENT_SECRET in .env, then connect again`
      );
    }
    if (!res.ok)
      throw new HammerheadHttpError(
        res.status,
        `Hammerhead token request failed: HTTP ${res.status}`
      );
    const body = (await res.json()) as TokenResponse;
    if (!body.access_token || !body.refresh_token) {
      throw new HammerheadHttpError(res.status, 'Hammerhead token response is missing tokens');
    }
    const tokens: StoredTokens = {
      accessToken: body.access_token,
      refreshToken: body.refresh_token,
      expiresAt: now() + (body.expires_in ?? 3600) * 1000,
      userId: body.user_id != null ? String(body.user_id) : null,
    };
    opts.tokens.save(tokens);
    return tokens;
  }

  async function refresh(): Promise<string> {
    refreshing ??= (async () => {
      const stored = opts.tokens.load();
      if (!stored) throw new HammerheadAuthError('Hammerhead is not connected');
      const fresh = await tokenRequest({
        grant_type: 'refresh_token',
        refresh_token: stored.refreshToken,
      });
      // Keep the user id from the original connect if the refresh response omits it.
      if (!fresh.userId && stored.userId) opts.tokens.save({ ...fresh, userId: stored.userId });
      return fresh.accessToken;
    })().finally(() => {
      refreshing = null;
    });
    return refreshing;
  }

  async function accessToken(force: boolean): Promise<string> {
    const stored = opts.tokens.load();
    if (!stored) throw new HammerheadAuthError('Hammerhead is not connected');
    if (!force && stored.expiresAt - now() > 5 * 60_000) return stored.accessToken;
    return refresh();
  }

  async function authorizedGet(path: string, accept?: string): Promise<Response> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const bearer = await accessToken(attempt > 0);
      const res = await withRetry(`${apiUrl}${path}`, {
        headers: {
          Authorization: `Bearer ${bearer}`,
          ...(accept ? { Accept: accept } : {}),
        },
      });
      if (res.status === 401 || res.status === 403) {
        // Hammerhead answers a missing scope with 401 too; refreshing would not help.
        const body = await res.text().catch(() => '');
        if (/insufficient scope/i.test(body)) {
          throw new HammerheadScopeError(
            `Hammerhead login lacks a permission for ${path.split('?')[0]}: connect Hammerhead again and allow it`
          );
        }
      }
      if (res.status === 401 && attempt === 0) continue; // token revoked/expired early: refresh
      if (res.status === 401 || res.status === 403) {
        throw new HammerheadAuthError(
          `Hammerhead denied access to ${path.split('?')[0]} (HTTP ${res.status}): connect Hammerhead again`
        );
      }
      if (!res.ok)
        throw new HammerheadHttpError(
          res.status,
          `Hammerhead request ${path.split('?')[0]} failed: HTTP ${res.status}`
        );
      return res;
    }
    throw new HammerheadAuthError('Hammerhead authentication failed');
  }

  return {
    authorizeUrl(state) {
      const qs = new URLSearchParams({
        client_id: opts.clientId,
        redirect_uri: opts.redirectUri,
        response_type: 'code',
        scope: HAMMERHEAD_SCOPE,
        state,
      });
      return `${authUrl}/oauth/authorize?${qs}`;
    },
    exchangeCode(code) {
      return tokenRequest({
        grant_type: 'authorization_code',
        code,
        redirect_uri: opts.redirectUri,
      });
    },
    async disconnect() {
      const stored = opts.tokens.load();
      opts.tokens.clear();
      if (!stored) return;
      try {
        await throttled(`${authUrl}/oauth/deauthorize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: opts.clientId,
            client_secret: opts.clientSecret,
            token: stored.accessToken,
          }).toString(),
        });
      } catch (e) {
        logger.warn(`Hammerhead deauthorize failed: ${(e as Error).message}`);
      }
    },
    async listActivities(page, perPage, startDate) {
      const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      if (startDate) qs.set('startDate', startDate);
      const res = await authorizedGet(`/activities?${qs}`);
      return (await res.json()) as HammerheadPage;
    },
    async getActivity(id) {
      const res = await authorizedGet(`/activities/${encodeURIComponent(id)}`);
      return (await res.json()) as HammerheadActivity;
    },
    async downloadFit(id) {
      const res = await authorizedGet(
        `/activities/${encodeURIComponent(id)}/file`,
        'application/vnd.ant.fit'
      );
      return new Uint8Array(await res.arrayBuffer());
    },
    async listRoutes(page, perPage) {
      const qs = new URLSearchParams({ page: String(page), perPage: String(perPage) });
      const res = await authorizedGet(`/routes?${qs}`);
      return (await res.json()) as HammerheadPage<HammerheadRouteSummary>;
    },
    async rawGet(path) {
      const res = await withRetry(`${apiUrl}${path}`, {
        headers: { Authorization: `Bearer ${await accessToken(false)}` },
      });
      return {
        status: res.status,
        contentType: res.headers.get('content-type'),
        body: new Uint8Array(await res.arrayBuffer()),
      };
    },
  };
}
