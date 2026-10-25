import type { Migration } from '../migrate.ts';
import { baseline } from './001_baseline.ts';
import { tracksRoutesGarmin } from './002_tracks_routes_garmin.ts';
import { hammerhead } from './003_hammerhead.ts';
import { plannedRoutes } from './004_planned_routes.ts';

/** Append-only. Never edit a migration that has shipped; add a new one instead. */
export const migrations: readonly Migration[] = [
  baseline,
  tracksRoutesGarmin,
  hammerhead,
  plannedRoutes,
];
