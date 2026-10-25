import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_GARMIN_BASE_URL } from './garmin/client.ts';
import { DEFAULT_HAMMERHEAD_API_URL, DEFAULT_HAMMERHEAD_AUTH_URL } from './hammerhead/client.ts';

const REPO_ROOT = path.resolve(import.meta.dirname, '../..');

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() ? v.trim() : undefined));

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DATA_DIR: z.string().default(path.join(REPO_ROOT, 'data')),
  DB_PATH: optionalString,
  TZ_NAME: optionalString,
  GARMIN_API_KEY: optionalString,
  GARMIN_API_BASE_URL: z.url().default(DEFAULT_GARMIN_BASE_URL),
  /** Minutes between automatic syncs; 0 disables the scheduler (manual "Sync now" still works). */
  GARMIN_SYNC_INTERVAL_MIN: z.coerce.number().min(0).default(60),
  HAMMERHEAD_CLIENT_ID: optionalString,
  HAMMERHEAD_CLIENT_SECRET: optionalString,
  /** Must exactly match a redirect URL registered in the Hammerhead dashboard. */
  HAMMERHEAD_REDIRECT_URI: z.url().default('http://localhost:5173/api/hammerhead/callback'),
  HAMMERHEAD_AUTH_URL: z.url().default(DEFAULT_HAMMERHEAD_AUTH_URL),
  HAMMERHEAD_API_URL: z.url().default(DEFAULT_HAMMERHEAD_API_URL),
  HAMMERHEAD_SYNC_INTERVAL_MIN: z.coerce.number().min(0).default(60),
  /** Share of each ride that must lie on the other for both to be the same route. */
  ROUTE_MATCH_THRESHOLD: z.coerce.number().min(0.5).max(1).default(0.9),
  /** Max distance (m) between tracks that still counts as "the same road". */
  ROUTE_MATCH_TOLERANCE_M: z.coerce.number().min(10).max(200).default(40),
  GEOCODER_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  GEOCODER_URL: z.url().default('https://nominatim.openstreetmap.org'),
  GEOCODER_LANGUAGE: z.string().default('de'),
  GEOCODER_USER_AGENT: z
    .string()
    .default('ridestack/1.0 (+https://github.com/schaefer-dev/ridestack)'),
});

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  fitDir: string;
  /** Sensor → bike rules (optional file, see bike-sensors.example.json). */
  bikeSensorsPath: string;
  timeZone: string;
  garmin: { apiKey: string | undefined; baseUrl: string; syncIntervalMin: number };
  /** null when HAMMERHEAD_CLIENT_ID / HAMMERHEAD_CLIENT_SECRET are not both set. */
  hammerhead: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    authUrl: string;
    apiUrl: string;
    syncIntervalMin: number;
  } | null;
  matching: { threshold: number; toleranceM: number };
  geocoder: { enabled: boolean; baseUrl: string; language: string; userAgent: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  // Relative paths are relative to the repository root, not to the workspace npm runs in.
  const dataDir = path.resolve(REPO_ROOT, e.DATA_DIR);
  return {
    port: e.PORT,
    dataDir,
    dbPath: e.DB_PATH
      ? path.resolve(REPO_ROOT, e.DB_PATH)
      : path.join(dataDir, 'cycling_archive.db'),
    backupDir: path.join(dataDir, 'backups'),
    fitDir: path.join(dataDir, 'fit'),
    bikeSensorsPath: path.join(dataDir, 'bike-sensors.json'),
    timeZone: e.TZ_NAME ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    garmin: {
      apiKey: e.GARMIN_API_KEY,
      baseUrl: e.GARMIN_API_BASE_URL,
      syncIntervalMin: e.GARMIN_SYNC_INTERVAL_MIN,
    },
    hammerhead:
      e.HAMMERHEAD_CLIENT_ID && e.HAMMERHEAD_CLIENT_SECRET
        ? {
            clientId: e.HAMMERHEAD_CLIENT_ID,
            clientSecret: e.HAMMERHEAD_CLIENT_SECRET,
            redirectUri: e.HAMMERHEAD_REDIRECT_URI,
            authUrl: e.HAMMERHEAD_AUTH_URL,
            apiUrl: e.HAMMERHEAD_API_URL,
            syncIntervalMin: e.HAMMERHEAD_SYNC_INTERVAL_MIN,
          }
        : null,
    matching: { threshold: e.ROUTE_MATCH_THRESHOLD, toleranceM: e.ROUTE_MATCH_TOLERANCE_M },
    geocoder: {
      enabled: e.GEOCODER_ENABLED,
      baseUrl: e.GEOCODER_URL,
      language: e.GEOCODER_LANGUAGE,
      userAgent: e.GEOCODER_USER_AGENT,
    },
  };
}
