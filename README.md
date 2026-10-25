# Cycling Archive

A personal archive of cycling rides: Garmin and Hammerhead rides arrive automatically, repeated rides are grouped
into named **routes**, everything is shown on a heatmap, and road/trail sections can be rated for
future route planning.

## Features

- **Garmin sync**: pulls every outdoor ride via the Garmin Connect Personal API (hourly + "Sync now"),
  keeps the original FIT files and the bike's sensors (power meter, speed sensor, …) per ride.
- **Hammerhead sync**: pulls Karoo rides via the Hammerhead API (OAuth, hourly + "Sync now").
- **One ride, many sources**: the same recording arriving from Garmin, Hammerhead or an upload is
  recognised (same activity id, start within ±60 s, or ≥ 50 % time overlap) and *linked* to the
  existing ride instead of imported twice. The first copy wins; later ones only fill empty fields.
- **Routes**: rides sharing ≥ 90 % of their path (in both directions) are grouped automatically;
  each route shows how often and when it was ridden, ride direction, and where a ride deviated
  (detours / skipped parts) from the usual way. Routes can be renamed, merged, and rides moved.
- Heatmap, "all tracks" view, and "which rides passed here?" on click.
- Section ratings (5 levels + surface tags).
- GPX / FIT upload for anything not on Garmin or Hammerhead.

## Screenshots

![Heatmap](assets/screenshots/readme_screenshot_01.jpg)
![Rides that went past a location](assets/screenshots/readme_screenshot_02.jpg)

## Quick start

Requires Node.js ≥ 22.18 (see `.nvmrc`; the server runs TypeScript directly, no build step).

```bash
cp .env.example .env      # add GARMIN_API_KEY (Garmin Connect → Settings → Personal API token)
npm ci
./start.sh                # or: npm run dev   → http://localhost:5173 (API on :3001)
```

On first start the server migrates the database (a backup is written to `data/backups/` first),
computes route groups, and — if `GARMIN_API_KEY` is set — syncs your Garmin history in the
background. The full first sync downloads every ride once and takes a few minutes.

### Hammerhead

1. In the [Hammerhead dashboard](https://dashboard.hammerhead.io/settings#api_settings) (API
   settings) add the redirect URL `http://localhost:5173/api/hammerhead/callback`, or the address
   you open the app at, e.g. `http://raspberrypi.local:5173/api/hammerhead/callback`, and set the
   same value as `HAMMERHEAD_REDIRECT_URI`.
2. Put `HAMMERHEAD_CLIENT_ID` and `HAMMERHEAD_CLIENT_SECRET` in `.env` and restart.
3. Click **Connect Hammerhead** in the sidebar and approve. The login is stored in the database
   and refreshed automatically; if it is ever revoked the sidebar shows **Reconnect**.
4. Optional: `npm run hammerhead:sync -- --dry-run` shows which Karoo rides would be linked to
   existing (Garmin) rides and which would be imported, before anything is written.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server |
| `npm run check` | lint + typecheck + all tests (run before pushing; CI runs the same) |
| `npm test` / `npm run test:watch` | tests only |
| `npm run format` | Prettier |
| `npm run garmin:sync -- --dry-run` | show what a sync would import/link/skip |
| `npm run garmin:sync -- --backfill` | walk the full Garmin history (retries gaps) |
| `npm run hammerhead:sync -- --dry-run` | show what a Hammerhead sync would import/link/skip |
| `npm run hammerhead:sync -- --backfill` | walk the full Hammerhead history |
| `npm run routes:rebuild` | re-cluster all rides (keeps manual moves and your route names) |
| `npm run routes:evaluate [-- --save]` | print route groups without writing; diff against a saved snapshot |

Stop the server before running the CLI commands that write (`garmin:sync`, `hammerhead:sync`,
`routes:rebuild`).

## Configuration

All settings are environment variables in `.env`; see [`.env.example`](.env.example).

## Project structure

```
server/src/
  main.ts, app.ts, bootstrap.ts, config.ts
  api/          HTTP handlers (zod-validated) + central error handling
  db/           connection, versioned migrations (PRAGMA user_version)
  rides/        repository + the single import pipeline and duplicate detection (all sources)
  matching/     route similarity, clustering, naming, geocoder, route service
  garmin/       Personal API client, sync, activity type mapping
  hammerhead/   OAuth API client, token store, sync, activity type mapping
  sync/         sync run bookkeeping + scheduler shared by both providers
  parsers/      GPX and FIT parsing
  track/, geo/  compact track storage, resampling, simplification, grid cells
  cli/          garmin-sync, hammerhead-sync, routes-rebuild, routes-evaluate
server/test/    unit, matcher scenario, API integration, migration and sync tests
client/src/     React + TanStack Query + Leaflet (TypeScript)
data/           SQLite DB, backups/, fit/ (gitignored)
```

## How route grouping works

Each ride is resampled to a point every 25 m. Two rides are the same route when at least 90 % of
each ride lies within 40 m of the other (`min(coverage A→B, coverage B→A) ≥ 0.9`). A long
extension therefore makes a different route, while a short detour (road closure) does not.
Every route has a reference ride (its medoid); new rides are compared against the reference of
candidate routes (pre-filtered via a spatial grid index), so routes cannot drift through chains of
slightly different rides. Direction is detected separately, so reversed loops share a route.

## Data & backups

Everything lives in `data/`. The database is SQLite in WAL mode; back it up with
`sqlite3 data/cycling_archive.db ".backup backup.db"` (copying the file while the server runs can
miss recent writes). `data/fit/` holds the original Garmin files (`data/fit/hammerhead/` the
Hammerhead ones) and allows re-processing later.
