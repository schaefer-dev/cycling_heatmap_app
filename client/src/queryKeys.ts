import type { QueryClient } from '@tanstack/react-query';
import type { BikeFilter } from './api';

/** All React Query keys in one place, so invalidation can't miss one. */
export const qk = {
  rides: (bike: BikeFilter) => ['rides', bike] as const,
  ride: (id: string | null) => ['ride', id] as const,
  rideLine: (id: string | null) => ['rideLine', id] as const,
  deviation: (id: string | null) => ['deviation', id] as const,
  routes: (bike: BikeFilter) => ['routes', bike] as const,
  route: (id: string | null) => ['route', id] as const,
  routeTracks: (id: string | null) => ['routeTracks', id] as const,
  sections: (bike: BikeFilter) => ['sections', bike] as const,
  heatmap: (bike: BikeFilter) => ['heatmap', bike] as const,
  bounds: (bike: BikeFilter) => ['bounds', bike] as const,
  allTracks: (bike: BikeFilter) => ['allTracks', bike] as const,
  stats: () => ['stats'] as const,
  syncStatus: () => ['syncStatus'] as const,
  suggestions: (includeWeak: boolean) => ['suggestions', includeWeak] as const,
};

/** After rides were added, changed or removed: everything derived from rides is stale. */
export function invalidateRideData(queryClient: QueryClient): Promise<void> {
  const prefixes = [
    'rides',
    'ride',
    'rideLine',
    'deviation',
    'routes',
    'route',
    'routeTracks',
    'sections',
    'heatmap',
    'bounds',
    'allTracks',
    'stats',
    'suggestions',
  ];
  return Promise.all(prefixes.map((p) => queryClient.invalidateQueries({ queryKey: [p] }))).then(
    () => undefined
  );
}

/** After a route was renamed, merged or a ride moved between routes. */
export function invalidateRouteData(queryClient: QueryClient): Promise<void> {
  const prefixes = [
    'rides',
    'ride',
    'deviation',
    'routes',
    'route',
    'routeTracks',
    'allTracks',
    'stats',
    'suggestions',
  ];
  return Promise.all(prefixes.map((p) => queryClient.invalidateQueries({ queryKey: [p] }))).then(
    () => undefined
  );
}

export function invalidateSectionData(queryClient: QueryClient): Promise<void> {
  return Promise.all(
    ['sections', 'ride', 'stats'].map((p) => queryClient.invalidateQueries({ queryKey: [p] }))
  ).then(() => undefined);
}
