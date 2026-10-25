import { useQuery } from '@tanstack/react-query';
import { Route as RouteIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Selection } from '../../App';
import { getRoutes, type BikeFilter, type RouteSummary } from '../../api';
import { BIKE, type BikeType } from '../../domain';
import { formatElevation, formatKm, formatRelative } from '../../format';
import { qk } from '../../queryKeys';
import { BikeDot, RideCount, RouteName } from '../ui/badges';
import { Select, SearchInput, Switch } from '../ui/fields';
import { Metrics } from '../ui/Metrics';
import { EmptyState, SkeletonRows } from '../ui/states';
import RouteDetail from './RouteDetail';
import { SORT_LABELS, sortRoutes, type SortKey } from './routeSort';

interface Props {
  bikeFilter: BikeFilter;
  selection: Selection;
  onSelectRoute(routeId: string | null): void;
  onSelectRide(rideId: string | null, routeId?: string | null): void;
}

/**
 * Route list; a selected route opens as a detail view. The list stays mounted (hidden) meanwhile,
 * so search, sort and scroll position survive the round trip.
 */
export default function RoutesTab({ bikeFilter, selection, onSelectRoute, onSelectRide }: Props) {
  const {
    data: routes,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.routes(bikeFilter),
    queryFn: () => getRoutes(bikeFilter),
  });
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<SortKey>('last');
  const [repeatedOnly, setRepeatedOnly] = useState(false);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = (routes ?? []).filter(
      (r) => (!q || (r.name ?? '').toLowerCase().includes(q)) && (!repeatedOnly || r.ride_count > 1)
    );
    return sortRoutes(filtered, sort);
  }, [routes, search, sort, repeatedOnly]);
  const maxCount = useMemo(() => Math.max(1, ...(routes ?? []).map((r) => r.ride_count)), [routes]);

  const detailId = selection.routeId;
  return (
    <>
      <div hidden={!!detailId} className="flex min-h-0 flex-1 flex-col">
        <div className="space-y-2 border-b border-line p-3">
          <SearchInput
            placeholder="Search routes…"
            aria-label="Search routes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="flex items-center gap-3">
            <Select
              aria-label="Sort routes"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="w-36"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </Select>
            <Switch
              label="Ridden more than once"
              checked={repeatedOnly}
              onChange={setRepeatedOnly}
              className="text-xs"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-1.5">
          {isLoading && <SkeletonRows />}
          {isError && (
            <EmptyState tone="danger">Could not load routes. Is the server running?</EmptyState>
          )}
          {routes && visible.length === 0 && (
            <EmptyState icon={<RouteIcon />}>
              {routes.length === 0
                ? 'No routes yet. Routes appear once rides are imported or synced.'
                : 'No routes match the search or filter.'}
            </EmptyState>
          )}
          {visible.map((route) => (
            <RouteRow
              key={route.id}
              route={route}
              maxCount={maxCount}
              onSelect={() => onSelectRoute(route.id)}
            />
          ))}
        </div>
      </div>
      {detailId && (
        <RouteDetail
          key={detailId}
          routeId={detailId}
          summary={routes?.find((r) => r.id === detailId)}
          allRoutes={routes ?? []}
          selectedRideId={selection.rideId}
          onBack={() => onSelectRoute(null)}
          onSelectRoute={onSelectRoute}
          onSelectRide={(rideId) =>
            onSelectRide(selection.rideId === rideId ? null : rideId, detailId)
          }
        />
      )}
    </>
  );
}

export function BikeDots({ bikeTypes }: { bikeTypes: string | null }) {
  const types = (bikeTypes ?? '').split(',').filter((t): t is BikeType => t in BIKE);
  return (
    <span className="flex shrink-0 gap-1" title={types.map((t) => BIKE[t].label).join(', ')}>
      {types.map((t) => (
        <BikeDot key={t} type={t} />
      ))}
    </span>
  );
}

export function RouteRow({
  route,
  maxCount,
  onSelect,
}: {
  route: RouteSummary;
  maxCount: number;
  onSelect(): void;
}) {
  return (
    <button
      onClick={onSelect}
      className="w-full rounded-md px-3 py-2.5 text-left transition-colors hover:bg-raised"
    >
      <span className="flex items-center gap-2">
        <RouteName name={route.name} className="flex-1 text-sm font-medium text-fg" />
        <BikeDots bikeTypes={route.bike_types} />
        {route.ride_count > 1 && <RideCount count={route.ride_count} max={maxCount} />}
      </span>
      {route.planned_route_name && (
        <span className="mt-0.5 block truncate text-xs text-signal/80">
          Planned: {route.planned_route_name}
        </span>
      )}
      <Metrics
        className="mt-1"
        items={[
          formatKm(route.avg_distance_km, 0),
          formatElevation(route.avg_elevation_gain_m),
          route.last_ridden && `last ${formatRelative(route.last_ridden)}`,
        ]}
      />
    </button>
  );
}
