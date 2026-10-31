import type { Ride, RouteSummary } from '../api';
import { favoriteGroups, type FavoriteKind } from '../components/sidebar/favorites';
import { sortRoutes, type SortKey } from '../components/sidebar/routeSort';
import type { PreviewTarget } from '../preview';

/**
 * One thing in a mobile list or the swipe deck. A favourite ridden only once opens as that ride
 * (like the desktop Favorites tab); everything else opens its route or ride page.
 */
export type Entry =
  | { kind: 'route'; key: string; route: RouteSummary }
  | { kind: 'single'; key: string; route: RouteSummary; rideId: string }
  | { kind: 'ride'; key: string; ride: Ride };

export type MobileTab = 'favorites' | 'routes' | 'rides';

export interface ListFilters {
  search: string;
  favoriteKind: FavoriteKind;
  routeSort: SortKey;
}

export const DEFAULT_FILTERS: ListFilters = { search: '', favoriteKind: 'all', routeSort: 'last' };

function routeEntry(route: RouteSummary): Entry {
  return route.ride_count <= 1 && route.reference_ride_id
    ? { kind: 'single', key: route.id, route, rideId: route.reference_ride_id }
    : { kind: 'route', key: route.id, route };
}

/** Favourites grouped by stars (most first), as entries. */
export function favoriteEntryGroups(
  routes: readonly RouteSummary[],
  filters: ListFilters
): Array<{ stars: number; entries: Entry[] }> {
  return favoriteGroups(routes, filters.favoriteKind, filters.search).map((g) => ({
    stars: g.stars,
    entries: g.favorites.map((f) => routeEntry(f.route)),
  }));
}

export function routeEntries(routes: readonly RouteSummary[], filters: ListFilters): Entry[] {
  const q = filters.search.trim().toLowerCase();
  const matching = q
    ? routes.filter((r) =>
        [r.name, r.planned_route_name].some((s) => (s ?? '').toLowerCase().includes(q))
      )
    : [...routes];
  return sortRoutes(matching, filters.routeSort).map((route) => ({
    kind: 'route',
    key: route.id,
    route,
  }));
}

/** Rides newest first; the search matches the ride title and its route name. */
export function rideEntries(rides: readonly Ride[], filters: ListFilters): Entry[] {
  const q = filters.search.trim().toLowerCase();
  const when = (r: Ride) => r.start_time ?? r.date ?? '';
  return rides
    .filter((r) => !q || [r.title, r.route_name].some((s) => (s ?? '').toLowerCase().includes(q)))
    .sort((a, b) => when(b).localeCompare(when(a)))
    .map((ride) => ({ kind: 'ride', key: ride.id, ride }));
}

/** The entries of a tab in list order (the deck uses the same order). */
export function tabEntries(
  tab: MobileTab,
  routes: readonly RouteSummary[] | undefined,
  rides: readonly Ride[] | undefined,
  filters: ListFilters
): Entry[] {
  if (tab === 'rides') return rideEntries(rides ?? [], filters);
  if (tab === 'routes') return routeEntries(routes ?? [], filters);
  return favoriteEntryGroups(routes ?? [], filters).flatMap((g) => g.entries);
}

/** The line an entry draws on the map. */
export function entryPreview(entry: Entry): PreviewTarget {
  if (entry.kind === 'route') return { kind: 'route', id: entry.route.id };
  if (entry.kind === 'single') return { kind: 'ride', id: entry.rideId };
  return { kind: 'ride', id: entry.ride.id };
}
