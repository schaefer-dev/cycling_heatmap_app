/**
 * Groups rides into routes.
 *
 * Every route has a reference ride (its medoid: the member most similar to all others). A ride
 * joins the route whose reference it matches best with score >= threshold, otherwise it starts a
 * new route. Comparing against one central reference instead of "any member" prevents chaining
 * (A≈B, B≈C, but A≉C) from slowly dragging a route somewhere else.
 *
 * The same `findBestRoute` is used for the initial clustering and for each newly imported ride.
 */
import { bboxesOverlap, type BBox, type LatLng } from '../geo/geo.ts';
import {
  compareTracks,
  lengthsCompatible,
  prepareTrack,
  type Direction,
  type MatchSettings,
  type PreparedTrack,
} from './similarity.ts';

export interface RideShape {
  id: string;
  /** Sort key for deterministic processing (start time, ms). */
  time: number;
  lengthM: number;
  bbox: BBox;
  line: LatLng[];
}

export interface RouteCandidate {
  routeId: string;
  reference: RideShape;
}

export interface RouteMatch {
  routeId: string;
  score: number;
  direction: Direction;
}

const BBOX_MARGIN_DEG = 0.002;

/** Caches prepared tracks; preparing is the expensive part when comparing many pairs. */
export class TrackCache {
  #cache = new Map<string, PreparedTrack>();
  #toleranceM: number;

  constructor(toleranceM: number) {
    this.#toleranceM = toleranceM;
  }

  get(ride: RideShape): PreparedTrack {
    let p = this.#cache.get(ride.id);
    if (!p) {
      p = prepareTrack(ride.line, this.#toleranceM);
      this.#cache.set(ride.id, p);
    }
    return p;
  }
}

export function compareRides(
  a: RideShape,
  b: RideShape,
  settings: MatchSettings,
  cache: TrackCache
) {
  if (a.id === b.id) return { score: 1, direction: 'forward' as Direction };
  if (!lengthsCompatible(a.lengthM, b.lengthM))
    return { score: 0, direction: 'forward' as Direction };
  if (!bboxesOverlap(a.bbox, b.bbox, BBOX_MARGIN_DEG))
    return { score: 0, direction: 'forward' as Direction };
  return compareTracks(cache.get(a), cache.get(b), settings.toleranceM);
}

export function findBestRoute(
  ride: RideShape,
  candidates: readonly RouteCandidate[],
  settings: MatchSettings,
  cache: TrackCache
): RouteMatch | null {
  let best: RouteMatch | null = null;
  for (const c of candidates) {
    const cmp = compareRides(ride, c.reference, settings, cache);
    if (cmp.score >= settings.threshold && (!best || cmp.score > best.score)) {
      best = { routeId: c.routeId, score: cmp.score, direction: cmp.direction };
    }
  }
  return best;
}

/** Member with the highest total similarity to the others (sampled for very large routes). */
export function medoid(
  members: readonly RideShape[],
  settings: MatchSettings,
  cache: TrackCache,
  sampleSize = 25
): RideShape {
  if (members.length <= 2) return members[0]!;
  const sample =
    members.length <= sampleSize
      ? members
      : members.filter((_, i) => i % Math.ceil(members.length / sampleSize) === 0);
  let best = members[0]!;
  let bestScore = -1;
  for (const m of members) {
    let total = 0;
    for (const o of sample) if (o.id !== m.id) total += compareRides(m, o, settings, cache).score;
    if (total > bestScore) {
      bestScore = total;
      best = m;
    }
  }
  return best;
}

export interface Cluster {
  /** Stable key: the id of the earliest member ride. */
  key: string;
  /** Group key from `fixed` when the cluster holds manually assigned rides. */
  fixedKey: string | null;
  referenceId: string;
  members: Array<{ rideId: string; score: number; direction: Direction }>;
}

/**
 * Full clustering of all rides. `fixed` maps ride ids that were assigned manually to a group key;
 * those stay together and are never moved.
 */
export function clusterRides(
  rides: readonly RideShape[],
  settings: MatchSettings,
  fixed: ReadonlyMap<string, string> = new Map()
): Cluster[] {
  const cache = new TrackCache(settings.toleranceM);
  const ordered = [...rides].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  const byId = new Map(ordered.map((r) => [r.id, r]));

  interface Work {
    members: RideShape[];
    reference: RideShape;
    fixedKey: string | null;
  }
  const groups = new Map<string, Work>(); // group id -> work
  const groupOf = new Map<string, string>(); // ride id -> group id
  let nextId = 0;
  const newGroup = (first: RideShape, fixedKey: string | null = null) => {
    const id = `g${nextId++}`;
    groups.set(id, { members: [first], reference: first, fixedKey });
    groupOf.set(first.id, id);
    return id;
  };

  // 1. Manual groups first.
  const fixedGroups = new Map<string, string>();
  for (const r of ordered) {
    const key = fixed.get(r.id);
    if (key === undefined) continue;
    const gid = fixedGroups.get(key);
    if (gid) {
      groups.get(gid)!.members.push(r);
      groupOf.set(r.id, gid);
    } else {
      fixedGroups.set(key, newGroup(r, key));
    }
  }
  for (const gid of fixedGroups.values()) {
    const g = groups.get(gid)!;
    g.reference = medoid(g.members, settings, cache);
  }

  const candidates = () =>
    [...groups.entries()].map(([routeId, g]) => ({ routeId, reference: g.reference }));

  // 2. Greedy assignment in chronological order (same rule as incremental matching).
  for (const r of ordered) {
    if (fixed.has(r.id)) continue;
    const match = findBestRoute(r, candidates(), settings, cache);
    if (match) {
      groups.get(match.routeId)!.members.push(r);
      groupOf.set(r.id, match.routeId);
    } else {
      newGroup(r);
    }
  }

  // 3. Re-centre each route on its medoid, then let rides move to the best route once.
  for (const g of groups.values()) g.reference = medoid(g.members, settings, cache);
  for (const r of ordered) {
    if (fixed.has(r.id)) continue;
    const current = groupOf.get(r.id)!;
    if (groups.get(current)!.reference.id === r.id) continue; // references anchor their route
    const match = findBestRoute(r, candidates(), settings, cache);
    const target = match ? match.routeId : null;
    if (target === current) continue;
    const from = groups.get(current)!;
    from.members = from.members.filter((m) => m.id !== r.id);
    if (target) {
      groups.get(target)!.members.push(r);
      groupOf.set(r.id, target);
    } else {
      newGroup(r);
    }
  }

  // 4. Finalise: drop empty groups, compute member scores against the reference.
  const clusters: Cluster[] = [];
  for (const g of groups.values()) {
    if (g.members.length === 0) continue;
    const members = [...g.members].sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
    if (!members.some((m) => m.id === g.reference.id)) {
      g.reference = medoid(members, settings, cache);
    }
    clusters.push({
      key: members[0]!.id,
      fixedKey: g.fixedKey,
      referenceId: g.reference.id,
      members: members.map((m) => {
        const cmp = compareRides(m, byId.get(g.reference.id)!, settings, cache);
        return { rideId: m.id, score: cmp.score, direction: cmp.direction };
      }),
    });
  }
  return clusters.sort((a, b) => a.key.localeCompare(b.key));
}
