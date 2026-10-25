import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Selection } from '../../App';
import {
  errorMessage,
  getRoute,
  getRoutes,
  mergeRoutes,
  moveRideToRoute,
  renameRoute,
  unlinkPlannedRoute,
  type BikeFilter,
  type Ride,
  type RouteSummary,
} from '../../api';
import { BIKE, type BikeType } from '../../domain';
import {
  formatDate,
  formatDuration,
  formatElevation,
  formatKm,
  formatPercent,
  formatRelative,
  formatSpeed,
  formatTime,
} from '../../format';
import { invalidateRouteData, qk } from '../../queryKeys';
import { useToast } from '../Toast';
import { sortRoutes, type SortKey } from './routeSort';

interface Props {
  bikeFilter: BikeFilter;
  selection: Selection;
  onSelectRoute(routeId: string | null): void;
  onSelectRide(rideId: string | null, routeId?: string | null): void;
}

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

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (selection.routeId)
      refs.current[selection.routeId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selection.routeId]);

  return (
    <>
      <div className="p-2 space-y-2 border-b">
        <input
          type="search"
          placeholder="Search routes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="flex items-center gap-3 text-xs text-gray-600">
          <label className="flex items-center gap-1">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="border rounded px-1 py-0.5"
            >
              <option value="last">Last ridden</option>
              <option value="count">Times ridden</option>
              <option value="distance">Distance</option>
              <option value="name">Name</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              checked={repeatedOnly}
              onChange={(e) => setRepeatedOnly(e.target.checked)}
            />
            Ridden more than once
          </label>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && <div className="p-4 text-center text-gray-500 text-sm">Loading…</div>}
        {isError && (
          <div className="p-4 text-center text-red-600 text-sm">Could not load routes.</div>
        )}
        {routes && visible.length === 0 && (
          <div className="p-4 text-center text-gray-500 text-sm">
            {routes.length === 0 ? 'No routes yet. Import or sync some rides.' : 'No routes match.'}
          </div>
        )}
        {visible.map((route) => (
          <div key={route.id} ref={(el) => void (refs.current[route.id] = el)}>
            <RouteCard
              route={route}
              allRoutes={routes ?? []}
              selected={selection.routeId === route.id}
              selectedRideId={selection.rideId}
              onToggle={() => onSelectRoute(selection.routeId === route.id ? null : route.id)}
              onSelectRide={(rideId) =>
                onSelectRide(selection.rideId === rideId ? null : rideId, route.id)
              }
            />
          </div>
        ))}
      </div>
    </>
  );
}

function BikeDots({ bikeTypes }: { bikeTypes: string | null }) {
  const types = (bikeTypes ?? '').split(',').filter((t): t is BikeType => t in BIKE);
  return (
    <span className="flex gap-0.5 shrink-0">
      {types.map((t) => (
        <span key={t} title={BIKE[t].label} className={`${BIKE[t].badge} w-2 h-2 rounded-full`} />
      ))}
    </span>
  );
}

function RouteCard(props: {
  route: RouteSummary;
  allRoutes: RouteSummary[];
  selected: boolean;
  selectedRideId: string | null;
  onToggle(): void;
  onSelectRide(rideId: string): void;
}) {
  const { route, selected } = props;
  return (
    <div
      className={`rounded-lg border ${selected ? 'border-blue-200 bg-blue-50/50' : 'border-transparent hover:bg-gray-50'}`}
    >
      <button onClick={props.onToggle} className="w-full text-left p-2.5" aria-expanded={selected}>
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-800 truncate flex-1">
            {route.name ?? 'Unnamed route'}
          </span>
          <BikeDots bikeTypes={route.bike_types} />
          {route.ride_count > 1 && (
            <span className="shrink-0 text-xs font-semibold text-blue-700 bg-blue-100 rounded-full px-2 py-0.5">
              {route.ride_count}×
            </span>
          )}
        </div>
        {route.planned_route_name && (
          <div className="text-xs text-blue-700 truncate">Planned: {route.planned_route_name}</div>
        )}
        <div className="text-xs text-gray-500 mt-0.5">
          {formatKm(route.avg_distance_km, 0)} · {formatElevation(route.avg_elevation_gain_m)} ·
          last {formatRelative(route.last_ridden)}
        </div>
      </button>
      {selected && <RouteDetails {...props} />}
    </div>
  );
}

function RouteDetails({
  route,
  allRoutes,
  selectedRideId,
  onSelectRide,
}: {
  route: RouteSummary;
  allRoutes: RouteSummary[];
  selectedRideId: string | null;
  onSelectRide(rideId: string): void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data: detail, isLoading } = useQuery({
    queryKey: qk.route(route.id),
    queryFn: () => getRoute(route.id),
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(route.name ?? '');

  const onDone = () => invalidateRouteData(queryClient);
  const rename = useMutation({
    mutationFn: (n: string) => renameRoute(route.id, n),
    onSuccess: () => {
      setEditing(false);
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const unlink = useMutation({
    mutationFn: () => unlinkPlannedRoute(route.id),
    onSuccess: () => {
      toast.show('Planned route label removed', 'success');
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const merge = useMutation({
    mutationFn: (into: string) => mergeRoutes(route.id, into),
    onSuccess: () => {
      toast.show('Routes merged', 'success');
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const otherRoutes = useMemo(
    () =>
      allRoutes
        .filter((r) => r.id !== route.id)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [allRoutes, route.id]
  );

  return (
    <div className="px-2.5 pb-2.5 space-y-2">
      <div className="flex items-center gap-2 text-xs">
        {editing ? (
          <form
            className="flex gap-1 flex-1"
            onSubmit={(e) => {
              e.preventDefault();
              if (name.trim()) rename.mutate(name.trim());
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
              className="flex-1 border border-blue-300 rounded px-1.5 py-0.5 text-sm"
              aria-label="Route name"
            />
            <button type="submit" className="text-blue-600 font-medium">
              Save
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-gray-500">
              Cancel
            </button>
          </form>
        ) : (
          <>
            <button
              onClick={() => {
                setName(route.name ?? '');
                setEditing(true);
              }}
              className="text-blue-600 hover:text-blue-800"
            >
              Rename
            </button>
            <select
              value=""
              onChange={(e) => {
                const target = otherRoutes.find((r) => r.id === e.target.value);
                if (
                  target &&
                  window.confirm(`Merge all ${route.ride_count} ride(s) into "${target.name}"?`)
                ) {
                  merge.mutate(target.id);
                }
              }}
              className="border rounded px-1 py-0.5 text-gray-600 max-w-[10rem]"
              aria-label="Merge into another route"
            >
              <option value="">Merge into…</option>
              {otherRoutes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} ({formatKm(r.avg_distance_km, 0)})
                </option>
              ))}
            </select>
            {route.planned_route_name && (
              <button
                onClick={() => unlink.mutate()}
                disabled={unlink.isPending}
                className="text-gray-500 hover:text-gray-700"
                title={`Remove the planned route label "${route.planned_route_name}" (the name stays)`}
              >
                Unlink planned
              </button>
            )}
            <span className="ml-auto text-gray-500">since {formatDate(route.first_ridden)}</span>
          </>
        )}
      </div>

      {isLoading && <div className="text-xs text-gray-500">Loading rides…</div>}
      <ul className="space-y-0.5">
        {detail?.rides.map((ride) => (
          <RouteRideRow
            key={ride.id}
            ride={ride}
            isReference={detail.reference_ride_id === ride.id}
            selected={selectedRideId === ride.id}
            onSelect={() => onSelectRide(ride.id)}
            otherRoutes={otherRoutes}
            soleRide={detail.rides.length === 1}
          />
        ))}
      </ul>
    </div>
  );
}

function RouteRideRow({
  ride,
  isReference,
  selected,
  onSelect,
  otherRoutes,
  soleRide,
}: {
  ride: Ride;
  isReference: boolean;
  selected: boolean;
  onSelect(): void;
  otherRoutes: RouteSummary[];
  soleRide: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const move = useMutation({
    mutationFn: (target: string | null) => moveRideToRoute(ride.id, target),
    onSuccess: () => invalidateRouteData(queryClient),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const offRoute = ride.route_similarity != null && ride.route_similarity < 0.97 && !isReference;
  const time = formatTime(ride.start_time);

  return (
    <li
      className={`group rounded px-2 py-1 text-xs cursor-pointer ${selected ? 'bg-blue-100' : 'hover:bg-white'}`}
      onClick={onSelect}
    >
      <div className="flex items-center gap-2">
        <span className="font-medium text-gray-800 w-28 shrink-0">
          {formatDate(ride.date, { weekday: true })}
        </span>
        <span className="text-gray-500 w-10 shrink-0">{time}</span>
        <span className="text-gray-700 w-14 shrink-0 text-right">{formatKm(ride.distance_km)}</span>
        <span className="text-gray-500 w-12 shrink-0 text-right">
          {formatDuration(ride.moving_time_s ?? ride.duration_s)}
        </span>
        <span className="ml-auto flex items-center gap-1">
          {ride.route_direction === 'reverse' && (
            <span title="Ridden in reverse direction" className="text-purple-600">
              ↺
            </span>
          )}
          {isReference ? (
            <span title="Reference ride for this route" className="text-gray-400">
              ref
            </span>
          ) : (
            <span
              title="Share of the ride on the route"
              className={offRoute ? 'text-orange-600 font-medium' : 'text-gray-400'}
            >
              {formatPercent(ride.route_similarity)}
            </span>
          )}
        </span>
      </div>
      <div className="flex items-center gap-2 text-gray-500">
        <span className="truncate flex-1">
          {ride.title}
          {ride.bike_type ? ` · ${BIKE[ride.bike_type].label}` : ' · bike unassigned'}
          {formatSpeed(ride.distance_km, ride.moving_time_s ?? ride.duration_s) &&
            ` · ${formatSpeed(ride.distance_km, ride.moving_time_s ?? ride.duration_s)}`}
        </span>
        <select
          value=""
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value;
            if (v) move.mutate(v === '__own__' ? null : v);
          }}
          className="opacity-0 group-hover:opacity-100 focus:opacity-100 border rounded px-0.5 text-[11px] max-w-[7rem]"
          aria-label="Move ride to another route"
        >
          <option value="">Move…</option>
          {!soleRide && <option value="__own__">To its own route</option>}
          {otherRoutes.map((r) => (
            <option key={r.id} value={r.id}>
              {r.name} ({formatKm(r.avg_distance_km, 0)})
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}
