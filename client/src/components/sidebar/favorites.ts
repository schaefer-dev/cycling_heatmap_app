import type { RouteSummary } from '../../api';
import { parseRouteRating, type RouteRating } from '../../domain';

export type FavoriteKind = 'all' | 'gravel' | 'road';

export interface Favorite {
  route: RouteSummary;
  rating: RouteRating;
}

export interface FavoriteGroup {
  stars: number;
  favorites: Favorite[];
}

/**
 * The user's favourites: routes whose name carries a rating ("xS[G|R] …"), grouped by stars
 * (most first) and most recently ridden first within a group. `kind` keeps only routes marked
 * G or R; `query` matches the name.
 */
export function favoriteGroups(
  routes: readonly RouteSummary[],
  kind: FavoriteKind = 'all',
  query = ''
): FavoriteGroup[] {
  const q = query.trim().toLowerCase();
  const byStars = new Map<number, Favorite[]>();
  for (const route of routes) {
    const rating = parseRouteRating(route.name);
    if (!rating) continue;
    if (kind !== 'all' && rating.kind !== kind) continue;
    if (q && !(route.name ?? '').toLowerCase().includes(q)) continue;
    const list = byStars.get(rating.stars) ?? [];
    list.push({ route, rating });
    byStars.set(rating.stars, list);
  }
  return [...byStars.entries()]
    .sort(([a], [b]) => b - a)
    .map(([stars, favorites]) => ({
      stars,
      favorites: favorites.sort((a, b) =>
        (b.route.last_ridden ?? '').localeCompare(a.route.last_ridden ?? '')
      ),
    }));
}

export function countFavorites(routes: readonly RouteSummary[] | undefined): number {
  return (routes ?? []).filter((r) => parseRouteRating(r.name) !== null).length;
}
