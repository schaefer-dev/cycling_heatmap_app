/**
 * Route names: prefer a title the rider typed in Garmin; otherwise describe the route by place
 * names (reverse geocoded); otherwise a plain fallback. Pure functions; I/O lives in routeService.
 */
import { haversineM, type LatLng } from '../geo/geo.ts';

/**
 * Titles Garmin (or another recorder) generates automatically, in English and German:
 * "Afternoon Gravel Ride", "Morning Ride", "Saarbrücken Rennradfahren", "Indoor Cycling",
 * "Homburg - Gravel Cycling", "Radfahren", ...
 */
const ACTIVITY_WORDS = [
  'ride',
  'cycling',
  'biking',
  'road cycling',
  'gravel cycling',
  'gravel ride',
  'mountain biking',
  'mountain bike ride',
  'radfahren',
  'rennradfahren',
  'gravel-radfahren',
  'gravelradfahren',
  'gravel/offroad-radfahren',
  'graveln',
  'mountainbiken',
  'mountainbikefahren',
  'e-bike',
  'e-bike-fahren',
  'indoor cycling',
  'indoor-radfahren',
  'virtual ride',
  'cyclocross',
];
const TIME_OF_DAY = '(morning|lunch|afternoon|evening|night|morgen|mittag|nachmittag|abend|nacht)';
const PLACE = `[\\p{L}\\p{M}.'’()-]+`;
const ACTIVITY = `(${ACTIVITY_WORDS.map((w) => w.replace(/[-\s]/g, '[-\\s]?')).join('|')})`;

const GENERIC_PATTERNS = [
  new RegExp(`^${ACTIVITY}$`, 'i'),
  new RegExp(`^${TIME_OF_DAY}(s)?\\s+([a-z]+\\s+)?${ACTIVITY}$`, 'i'),
  // "<place> Rennradfahren", "<place> - Gravel Cycling", "Rehlingen-Siersburg Radfahren"
  new RegExp(`^${PLACE}(\\s+${PLACE}){0,3}\\s*[-–]?\\s+${ACTIVITY}$`, 'iu'),
  /^(unnamed|untitled)( ride)?$/i,
  /^activity[_\s-]?\d*$/i,
  /^\d+$/,
];

export function isGenericTitle(title: string | null | undefined): boolean {
  const t = (title ?? '').trim();
  if (t.length === 0) return true;
  return GENERIC_PATTERNS.some((re) => re.test(t));
}

/** Strips repeat counters riders append to a route's title: "Waldrunde #3" → "Waldrunde". */
export function titleBase(title: string): string {
  return title.replace(/\s*#\s*\d+\s*$/, '').trim();
}

/** Most frequent custom title (ignoring "#n" counters) among the rides; ties: most recent. */
export function pickTitleName(
  rides: ReadonlyArray<{ title: string | null; time: number }>
): string | null {
  const counts = new Map<string, { count: number; latest: number; original: string }>();
  for (const r of rides) {
    if (isGenericTitle(r.title)) continue;
    const original = titleBase(r.title!.trim()) || r.title!.trim();
    const key = original.toLowerCase();
    const c = counts.get(key);
    if (c) {
      c.count++;
      if (r.time > c.latest) {
        c.latest = r.time;
        c.original = original;
      }
    } else {
      counts.set(key, { count: 1, latest: r.time, original });
    }
  }
  let best: { count: number; latest: number; original: string } | null = null;
  for (const c of counts.values()) {
    if (!best || c.count > best.count || (c.count === best.count && c.latest > best.latest))
      best = c;
  }
  return best?.original ?? null;
}

export const LOOP_MAX_GAP_M = 1000;

/** The point of the line farthest from its start (the "turnaround" of a loop or the destination). */
export function farthestPoint(line: readonly LatLng[]): LatLng {
  const start = line[0]!;
  let best = start;
  let bestD = -1;
  for (const p of line) {
    const d = haversineM(start.lat, start.lng, p.lat, p.lng);
    if (d > bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

export function formatKm(lengthM: number): string {
  return `${Math.round(lengthM / 1000)} km`;
}

export function geoName(opts: {
  startPlace: string;
  farPlace: string | null;
  endPlace: string | null;
  isLoop: boolean;
  lengthM: number;
}): string {
  const km = formatKm(opts.lengthM);
  if (opts.isLoop) {
    return opts.farPlace && opts.farPlace !== opts.startPlace
      ? `${opts.startPlace} loop via ${opts.farPlace} · ${km}`
      : `${opts.startPlace} loop · ${km}`;
  }
  const dest = opts.endPlace ?? opts.farPlace;
  return dest && dest !== opts.startPlace
    ? `${opts.startPlace} → ${dest} · ${km}`
    : `${opts.startPlace} · ${km}`;
}

export function fallbackName(lengthM: number, bikeType: string | null): string {
  return `Route · ${formatKm(lengthM)}${bikeType ? ` ${bikeType}` : ''}`;
}

/** Appends " (2)", " (3)", ... until `isTaken` returns false. */
export function uniqueName(base: string, isTaken: (name: string) => boolean): string {
  if (!isTaken(base)) return base;
  for (let i = 2; ; i++) {
    const candidate = `${base} (${i})`;
    if (!isTaken(candidate)) return candidate;
  }
}
