/**
 * Demo dataset: ~110 synthetic rides on a dozen real road loops around Girona (Spain), imported
 * through the normal pipeline so routes, heatmap and statistics behave exactly as with real data.
 * Deterministic (seeded), contains no personal data.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/connection.ts';
import type { BikeType } from '../domain.ts';
import { distanceM, localProjection, type LatLng } from '../geo/geo.ts';
import type { RouteService } from '../matching/routeService.ts';
import type { ParsedActivity } from '../parsers/parsedActivity.ts';
import type { RideImporter } from '../rides/importService.ts';
import type { TrackPoint } from '../track/codec.ts';

export interface DemoRoute {
  id: string;
  name: string;
  bikeType: BikeType;
  /** [lat, lng, elevation m] */
  points: Array<[number, number, number]>;
}

export interface DemoRoutesFile {
  attribution: string;
  routes: DemoRoute[];
}

export function loadDemoRoutes(): DemoRoutesFile {
  return JSON.parse(
    readFileSync(path.join(import.meta.dirname, 'routes.json'), 'utf8')
  ) as DemoRoutesFile;
}

/** How often each loop was ridden, and the title the rider gave it (null = device default). */
const PLAN: Record<string, { rides: number; title: string | null }> = {
  angels: { rides: 16, title: '5S Els Àngels' },
  rocacorba: { rides: 9, title: '6S Rocacorba' },
  banyoles: { rides: 12, title: null },
  coast: { rides: 6, title: '6S Sant Feliu coast' },
  bisbal: { rides: 8, title: null },
  olot: { rides: 3, title: 'Besalú – Olot' },
  ter: { rides: 19, title: null },
  carrilet: { rides: 10, title: '4SG Carrilet' },
  hilari: { rides: 4, title: null },
  pubol: { rides: 7, title: '3SG Púbol' },
  tossa: { rides: 5, title: null },
  gavarres: { rides: 6, title: null },
};

const FIRST_DAY = Date.UTC(2024, 2, 1);
const DAYS = 960;
const ACTIVITY_TYPE: Record<BikeType, string> = {
  road: 'road_biking',
  gravel: 'gravel_cycling',
  mtb: 'mountain_biking',
};
const BASE_SPEED_MPS: Record<BikeType, number> = { road: 7.6, gravel: 6, mtb: 4.8 };
const STEP_M = 8;
const DAY_MS = 86_400_000;

export interface SeedResult {
  rides: number;
  routes: number;
}

/** Imports the demo rides into an empty database (throws if it already has rides). */
export async function seedDemo(
  { db, importer, routes }: { db: DB; importer: RideImporter; routes: RouteService },
  file: DemoRoutesFile = loadDemoRoutes(),
  opts: { seed?: number } = {}
): Promise<SeedResult> {
  const { n } = db.prepare(`SELECT COUNT(*) AS n FROM rides`).get() as { n: number };
  if (n > 0) throw new Error(`the database already contains ${n} ride(s)`);
  const rand = rng(opts.seed ?? 2026);
  const usedDays = new Set<number>();
  let imported = 0;

  for (const route of file.routes) {
    const plan = PLAN[route.id] ?? { rides: 3, title: null };
    for (let n = 0; n < plan.rides; n++) {
      const day = pickDay(rand, usedDays);
      usedDays.add(day);

      const startHour = 6.5 + rand() * 9;
      const startMs = FIRST_DAY + day * DAY_MS + Math.round((startHour - 1) * 3_600_000);
      const reversed = route.id !== 'carrilet' && rand() < 0.3;
      const points = recordRide(route, {
        rand,
        startMs,
        reversed,
        speed: BASE_SPEED_MPS[route.bikeType] * (0.88 + rand() * 0.22),
      });
      const titled = plan.title !== null && rand() < 0.8;
      const parsed: ParsedActivity = {
        title: titled ? plan.title : defaultTitle(startHour),
        points,
        activityType: ACTIVITY_TYPE[route.bikeType],
        isCycling: true,
        detectedBikeType: route.bikeType,
      };
      const result = importer.import(parsed, { source: 'gpx', bikeType: route.bikeType });
      if (result.status === 'imported') imported++;
    }
  }

  const rebuilt = routes.rebuild();
  try {
    await routes.nameRoutes();
  } catch {
    // Offline: routes keep their title-based or placeholder names.
  }
  return { rides: imported, routes: rebuilt.routes };
}

/** A free day; weekends twice as likely, a little more riding in summer. */
function pickDay(rand: () => number, used: ReadonlySet<number>): number {
  for (;;) {
    const day = Math.floor(rand() * DAYS);
    if (used.has(day)) continue;
    const date = new Date(FIRST_DAY + day * DAY_MS);
    const weekend = date.getUTCDay() === 0 || date.getUTCDay() === 6;
    const summer = Math.abs(date.getUTCMonth() - 6) <= 2;
    if (!weekend && rand() < 0.5) continue;
    if (!summer && rand() < 0.25) continue;
    return day;
  }
}

function defaultTitle(hour: number): string {
  if (hour < 11) return 'Morning Ride';
  if (hour < 14) return 'Lunch Ride';
  return 'Afternoon Ride';
}

/** Turns a template into a recorded-looking track: dense, noisy, with grade-dependent speed. */
function recordRide(
  route: DemoRoute,
  o: { rand: () => number; startMs: number; reversed: boolean; speed: number }
): TrackPoint[] {
  const src = o.reversed ? [...route.points].reverse() : route.points;
  const dense = densify(src, STEP_M);
  // The DEM is coarse (roads next to slopes pick up bumps): smooth over ~600 m like a barometer.
  const ele = movingAverage(
    dense.map((p) => p.ele),
    40
  );

  const proj = localProjection(dense[0]!.lat);
  const mPerDegLat = proj.y(1);
  const mPerDegLng = proj.x(1);
  const rho = 0.96;
  const sigma = 2.5;
  const innovation = Math.sqrt(1 - rho * rho) * sigma;
  let nx = gaussian(o.rand) * sigma;
  let ny = gaussian(o.rand) * sigma;
  let t = o.startMs;
  const out: TrackPoint[] = [];
  for (let i = 0; i < dense.length; i++) {
    nx = rho * nx + innovation * gaussian(o.rand);
    ny = rho * ny + innovation * gaussian(o.rand);
    if (i > 0) {
      const grade = (ele[i]! - ele[i - 1]!) / STEP_M;
      const factor = Math.min(1.6, Math.max(0.35, 1 - grade * 7));
      t += (STEP_M / (o.speed * factor)) * 1000;
    }
    out.push({
      lat: dense[i]!.lat + ny / mPerDegLat,
      lng: dense[i]!.lng + nx / mPerDegLng,
      ele: Math.round((ele[i]! + gaussian(o.rand) * 0.4) * 10) / 10,
      time: Math.round(t),
    });
  }
  return out;
}

/** Points every `stepM` metres along the line, elevation interpolated linearly. */
function densify(line: DemoRoute['points'], stepM: number): Array<LatLng & { ele: number }> {
  const out: Array<LatLng & { ele: number }> = [];
  let carry = 0;
  for (let i = 1; i < line.length; i++) {
    const [lat0, lng0, e0] = line[i - 1]!;
    const [lat1, lng1, e1] = line[i]!;
    const seg = distanceM({ lat: lat0, lng: lng0 }, { lat: lat1, lng: lng1 });
    if (seg === 0) continue;
    for (let along = carry; along < seg; along += stepM) {
      const t = along / seg;
      out.push({
        lat: lat0 + (lat1 - lat0) * t,
        lng: lng0 + (lng1 - lng0) * t,
        ele: e0 + (e1 - e0) * t,
      });
    }
    carry = (carry - seg) % stepM;
    if (carry < 0) carry += stepM;
  }
  const [lat, lng, ele] = line[line.length - 1]!;
  out.push({ lat, lng, ele });
  return out;
}

function movingAverage(values: number[], radius: number): number[] {
  const prefix = [0];
  for (const v of values) prefix.push(prefix[prefix.length - 1]! + v);
  return values.map((_, i) => {
    const lo = Math.max(0, i - radius);
    const hi = Math.min(values.length, i + radius + 1);
    return (prefix[hi]! - prefix[lo]!) / (hi - lo);
  });
}

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  const u = Math.max(rand(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}
