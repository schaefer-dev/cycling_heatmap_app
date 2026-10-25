import path from 'node:path';
import { z } from 'zod';
import { DEFAULT_GARMIN_BASE_URL } from './garmin/client.ts';

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
  GEOCODER_USER_AGENT: z.string().default('cycling-archive/1.0 (personal ride archive)'),
});

export interface Config {
  port: number;
  dataDir: string;
  dbPath: string;
  backupDir: string;
  fitDir: string;
  timeZone: string;
  garmin: { apiKey: string | undefined; baseUrl: string; syncIntervalMin: number };
  matching: { threshold: number; toleranceM: number };
  geocoder: { enabled: boolean; baseUrl: string; language: string; userAgent: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid configuration:\n${z.prettifyError(parsed.error)}`);
  }
  const e = parsed.data;
  const dataDir = path.resolve(e.DATA_DIR);
  return {
    port: e.PORT,
    dataDir,
    dbPath: e.DB_PATH ? path.resolve(e.DB_PATH) : path.join(dataDir, 'cycling_archive.db'),
    backupDir: path.join(dataDir, 'backups'),
    fitDir: path.join(dataDir, 'fit'),
    timeZone: e.TZ_NAME ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    garmin: {
      apiKey: e.GARMIN_API_KEY,
      baseUrl: e.GARMIN_API_BASE_URL,
      syncIntervalMin: e.GARMIN_SYNC_INTERVAL_MIN,
    },
    matching: { threshold: e.ROUTE_MATCH_THRESHOLD, toleranceM: e.ROUTE_MATCH_TOLERANCE_M },
    geocoder: {
      enabled: e.GEOCODER_ENABLED,
      baseUrl: e.GEOCODER_URL,
      language: e.GEOCODER_LANGUAGE,
      userAgent: e.GEOCODER_USER_AGENT,
    },
  };
}
