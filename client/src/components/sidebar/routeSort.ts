import type { RouteSummary } from '../../api';

export type SortKey = 'last' | 'count' | 'distance' | 'name';

export function sortRoutes(routes: RouteSummary[], key: SortKey): RouteSummary[] {
  const byName = (a: RouteSummary, b: RouteSummary) => (a.name ?? '').localeCompare(b.name ?? '');
  const sorted = [...routes];
  switch (key) {
    case 'count':
      return sorted.sort(
        (a, b) =>
          b.ride_count - a.ride_count || (b.last_ridden ?? '').localeCompare(a.last_ridden ?? '')
      );
    case 'distance':
      return sorted.sort((a, b) => (b.avg_distance_km ?? 0) - (a.avg_distance_km ?? 0));
    case 'name':
      return sorted.sort(byName);
    default:
      return sorted.sort((a, b) => (b.last_ridden ?? '').localeCompare(a.last_ridden ?? ''));
  }
}
