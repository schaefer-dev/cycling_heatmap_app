import type { RouteSummary } from '../../api';
import { parseRouteRating } from '../../domain';

export type SortKey = 'last' | 'count' | 'rating' | 'distance' | 'name';

export const SORT_LABELS: Record<SortKey, string> = {
  last: 'Last ridden',
  count: 'Times ridden',
  rating: 'Rating',
  distance: 'Distance',
  name: 'Name',
};

export function sortRoutes(routes: RouteSummary[], key: SortKey): RouteSummary[] {
  const byName = (a: RouteSummary, b: RouteSummary) => (a.name ?? '').localeCompare(b.name ?? '');
  const byLast = (a: RouteSummary, b: RouteSummary) =>
    (b.last_ridden ?? '').localeCompare(a.last_ridden ?? '');
  const sorted = [...routes];
  switch (key) {
    case 'count':
      return sorted.sort((a, b) => b.ride_count - a.ride_count || byLast(a, b));
    case 'rating': {
      // Most stars first; unrated routes last; ties go to the most recently ridden.
      const stars = (r: RouteSummary) => parseRouteRating(r.name)?.stars ?? 0;
      return sorted.sort((a, b) => stars(b) - stars(a) || byLast(a, b));
    }
    case 'distance':
      return sorted.sort((a, b) => (b.avg_distance_km ?? 0) - (a.avg_distance_km ?? 0));
    case 'name':
      return sorted.sort(byName);
    default:
      return sorted.sort(byLast);
  }
}
