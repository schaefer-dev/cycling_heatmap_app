/**
 * Suggests planned-route names (Hammerhead library) for route groups. Pure: no I/O, no writes.
 * The result is only ever shown for review; applying a suggestion is a separate, explicit action.
 *
 * Hammerhead offers no route geometry, only name, distance, elevation gain and creation time, so
 * suggestions rest on two signals, calibrated on the user's data (2026-10-25: route groups whose
 * ride title equals a planned route name):
 * - distance: rides were within ±2 % of the plan, sometimes ~+11 % (riding to the start);
 * - timing: the route was ridden 0–1 days after it was planned, or the route was saved right
 *   after riding it (e.g. "6SR zu sonnig, zu schnell, zu geil": created 21 h after the ride).
 * Elevation gain is only a weak check: rides recorded 12–72 % more than planned.
 */
import { isGenericTitle, titleBase } from './naming.ts';

/**
 * The user's naming convention for routes worth keeping: a star rating "1S"…"6S", optionally
 * followed by G (gravel) or R (road), e.g. "6S Ost 65k Waldtour", "5SR Rennrad Nied", "6SG …".
 * Every other planned route is temporary and is not suggested (for now). "?S" (no rating yet)
 * does not count either.
 */
export const RATED_ROUTE_NAME = /^\s*[1-6]S[GR]?(?![\p{L}\p{N}])/u;

export function isRatedRouteName(name: string | null | undefined): boolean {
  return RATED_ROUTE_NAME.test(name ?? '');
}

/** Group distance may be this much shorter / longer than the plan. */
export const MAX_SHORTER = 0.05;
export const MAX_LONGER = 0.15;
/** Strong suggestions: within ±5 % and ridden at most 2 days after (or before) planning. */
export const STRONG_MAX_DISTANCE = 0.05;
export const STRONG_MAX_LAG_DAYS = 2;
/** A ride this long before the route was created counts too: the route was saved after the ride. */
export const MAX_RIDE_BEFORE_DAYS = 2;
/** Rides this close before creation read as "the same day" (clock skew, planning at the start). */
const SAME_TIME_BEFORE_DAYS = 0.25;
export const MAX_CANDIDATES = 3;

const DAY_MS = 86_400_000;

export interface GroupStats {
  routeId: string;
  name: string | null;
  nameSource: string | null;
  rideCount: number;
  /** Median of the member rides' recorded distance. */
  distanceKm: number;
  elevationGainM: number | null;
  /** Start times (epoch ms) of all member rides. */
  rideStarts: number[];
  firstRidden: string | null;
  lastRidden: string | null;
}

export interface PlannedRoute {
  id: string;
  name: string | null;
  createdAt: string | null;
  distanceM: number | null;
  gainM: number | null;
  deleted: boolean;
}

export interface Decisions {
  /** `${routeId}|${plannedRouteId}` pairs the user rejected. */
  rejected: ReadonlySet<string>;
  /** Route groups that already carry an accepted planned route. */
  accepted: ReadonlySet<string>;
}

export interface Candidate {
  plannedRouteId: string;
  name: string;
  distanceKm: number;
  gainM: number | null;
  createdAt: string | null;
  score: number;
  strength: 'strong' | 'weak';
  /** Relative distance difference group vs plan (+0.03 = group 3 % longer). */
  distanceDiff: number;
  /**
   * Days from planning to the closest ride; negative when the ride was before the route was
   * created (at most MAX_RIDE_BEFORE_DAYS). Null when no ride is close in time or after it.
   */
  lagDays: number | null;
  reasons: string[];
  /** How many other groups this planned route is (also) suggested for. */
  otherGroups: number;
}

export interface GroupSuggestion {
  group: GroupStats;
  candidates: Candidate[];
}

export const pairKey = (routeId: string, plannedRouteId: string) => `${routeId}|${plannedRouteId}`;

function dateScore(lagDays: number | null): number {
  if (lagDays === null) return 0;
  if (lagDays < 0) return 1; // ridden shortly before the route was saved
  if (lagDays <= STRONG_MAX_LAG_DAYS) return 1;
  if (lagDays <= 7) return 0.6;
  if (lagDays <= 30) return 0.25;
  return 0;
}

function lagDaysOf(rideStarts: readonly number[], createdAt: string | null): number | null {
  const created = createdAt ? Date.parse(createdAt) : Number.NaN;
  if (!Number.isFinite(created)) return null;
  let best: number | null = null;
  for (const s of rideStarts) {
    let lag = (s - created) / DAY_MS;
    if (lag < -MAX_RIDE_BEFORE_DAYS) continue;
    if (lag < 0 && lag >= -SAME_TIME_BEFORE_DAYS) lag = 0;
    if (best === null || Math.abs(lag) < Math.abs(best)) best = lag;
  }
  return best;
}

function describeLag(lagDays: number): string {
  if (lagDays < 0) {
    const hours = -lagDays * 24;
    return hours < 36
      ? `ridden ${Math.round(hours)} h before the route was saved`
      : `ridden ${Math.round(-lagDays)} days before the route was saved`;
  }
  if (lagDays < 1) return 'ridden the same day it was planned';
  if (lagDays < 2) return 'ridden the day after it was planned';
  return `first ridden ${Math.round(lagDays)} days after planning`;
}

function scoreCandidate(group: GroupStats, p: PlannedRoute): Omit<Candidate, 'otherGroups'> | null {
  const plannedKm = (p.distanceM ?? 0) / 1000;
  if (plannedKm <= 0) return null;
  const diff = group.distanceKm / plannedKm - 1;
  if (diff < -MAX_SHORTER || diff > MAX_LONGER) return null;
  const distScore = 1 - Math.abs(diff) / (diff < 0 ? MAX_SHORTER : MAX_LONGER);
  const lagDays = lagDaysOf(group.rideStarts, p.createdAt);
  const ds = dateScore(lagDays);
  const gainOff =
    p.gainM && group.elevationGainM !== null
      ? group.elevationGainM < 0.7 * p.gainM || group.elevationGainM > 2.5 * p.gainM
      : false;
  const score = (0.6 * distScore + 0.4 * ds) * (gainOff ? 0.8 : 1);

  const reasons = [`distance ${diff >= 0 ? '+' : '−'}${Math.abs(diff * 100).toFixed(1)} %`];
  if (lagDays !== null && ds > 0) reasons.push(describeLag(lagDays));
  else reasons.push('no ride shortly after it was planned');
  if (p.gainM && group.elevationGainM !== null) {
    reasons.push(
      `elevation ${Math.round(group.elevationGainM)} m ridden vs ${Math.round(p.gainM)} m planned`
    );
  }
  return {
    plannedRouteId: p.id,
    name: p.name!.trim(),
    distanceKm: Math.round(plannedKm * 10) / 10,
    gainM: p.gainM !== null ? Math.round(p.gainM) : null,
    createdAt: p.createdAt,
    score: Math.round(score * 1000) / 1000,
    strength: ds === 1 && Math.abs(diff) <= STRONG_MAX_DISTANCE ? 'strong' : 'weak',
    distanceDiff: Math.round(diff * 1000) / 1000,
    lagDays: lagDays !== null ? Math.round(lagDays * 10) / 10 : null,
    reasons,
  };
}

/**
 * Candidate planned routes per eligible group: only rated planned routes ("5S …", see
 * RATED_ROUTE_NAME); groups the user renamed, or that already have an accepted planned route, get
 * none. Strong candidates are always listed; weak ones only with
 * `includeWeak` (then at most MAX_CANDIDATES per group). Groups with a strong candidate first.
 */
export function suggestPlannedNames(
  groups: readonly GroupStats[],
  planned: readonly PlannedRoute[],
  decisions: Decisions,
  opts: { includeWeak?: boolean } = {}
): GroupSuggestion[] {
  const usable = planned.filter(
    (p) => !p.deleted && p.name && !isGenericTitle(p.name) && isRatedRouteName(p.name)
  );
  const all: GroupSuggestion[] = [];
  for (const group of groups) {
    if (group.nameSource === 'user' || decisions.accepted.has(group.routeId)) continue;
    // Same name planned twice (copies, re-imports): keep the best-scoring one.
    const byName = new Map<string, Omit<Candidate, 'otherGroups'>>();
    for (const p of usable) {
      if (decisions.rejected.has(pairKey(group.routeId, p.id))) continue;
      const c = scoreCandidate(group, p);
      if (!c) continue;
      const key = titleBase(c.name).toLowerCase();
      const prev = byName.get(key);
      if (!prev || c.score > prev.score) byName.set(key, c);
    }
    const sorted = [...byName.values()].sort((a, b) => b.score - a.score);
    const strong = sorted.filter((c) => c.strength === 'strong');
    const candidates = opts.includeWeak
      ? [...strong, ...sorted.filter((c) => c.strength === 'weak')].slice(
          0,
          Math.max(MAX_CANDIDATES, strong.length)
        )
      : strong;
    if (candidates.length > 0) {
      all.push({ group, candidates: candidates.map((c) => ({ ...c, otherGroups: 0 })) });
    }
  }

  const uses = new Map<string, number>();
  for (const s of all)
    for (const c of s.candidates) uses.set(c.plannedRouteId, (uses.get(c.plannedRouteId) ?? 0) + 1);
  for (const s of all)
    for (const c of s.candidates) c.otherGroups = uses.get(c.plannedRouteId)! - 1;

  const rank = (s: GroupSuggestion) =>
    (s.candidates[0]!.strength === 'strong' ? 1 : 0) * 10 + s.candidates[0]!.score;
  return all.sort((a, b) => rank(b) - rank(a));
}
