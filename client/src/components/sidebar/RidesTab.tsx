import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteRide,
  errorMessage,
  getRides,
  getRoutes,
  updateRide,
  type BikeFilter,
  type Ride,
} from '../../api';
import { BIKE, BIKE_TYPES, type BikeType } from '../../domain';
import { formatDate, formatDuration, formatElevation, formatKm, formatTime } from '../../format';
import { invalidateRideData, qk } from '../../queryKeys';
import { useToast } from '../Toast';

interface Props {
  bikeFilter: BikeFilter;
  selectedRideId: string | null;
  onSelectRide(rideId: string | null): void;
  onShowRoute(routeId: string): void;
}

/** Parses an optional numeric filter input; '' or garbage means "no limit". */
function parseLimit(v: string): number | null {
  const n = Number.parseFloat(v);
  return v.trim() === '' || !Number.isFinite(n) ? null : n;
}

export default function RidesTab({ bikeFilter, selectedRideId, onSelectRide, onShowRoute }: Props) {
  const {
    data: rides,
    isLoading,
    isError,
  } = useQuery({ queryKey: qk.rides(bikeFilter), queryFn: () => getRides(bikeFilter) });
  // Shares the cache with the Routes tab; used to show how often a ride's route was ridden.
  const { data: routes } = useQuery({ queryKey: qk.routes(null), queryFn: () => getRoutes(null) });
  const routeCounts = useMemo(
    () => new Map((routes ?? []).map((r) => [r.id, r.ride_count])),
    [routes]
  );

  const [search, setSearch] = useState('');
  const [minKm, setMinKm] = useState('');
  const [maxKm, setMaxKm] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const min = parseLimit(minKm);
    const max = parseLimit(maxKm);
    return (rides ?? []).filter((r) => {
      const km = r.distance_km ?? 0;
      return (
        (!q ||
          (r.title ?? '').toLowerCase().includes(q) ||
          (r.route_name ?? '').toLowerCase().includes(q)) &&
        (min === null || km >= min) &&
        (max === null || km <= max)
      );
    });
  }, [rides, search, minKm, maxKm]);

  const refs = useRef<Record<string, HTMLDivElement | null>>({});
  useEffect(() => {
    if (selectedRideId)
      refs.current[selectedRideId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedRideId]);

  return (
    <>
      <div className="p-2 space-y-2 border-b">
        <input
          type="search"
          placeholder="Search rides or routes…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <div className="flex items-center gap-2 text-xs text-gray-600">
          <span>km</span>
          <input
            type="number"
            min="0"
            placeholder="min"
            value={minKm}
            onChange={(e) => setMinKm(e.target.value)}
            className="w-16 px-2 py-0.5 border rounded"
            aria-label="Minimum distance"
          />
          <span>–</span>
          <input
            type="number"
            min="0"
            placeholder="max"
            value={maxKm}
            onChange={(e) => setMaxKm(e.target.value)}
            className="w-16 px-2 py-0.5 border rounded"
            aria-label="Maximum distance"
          />
          {rides && (
            <span className="ml-auto text-gray-400">
              {filtered.length} of {rides.length}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 space-y-1">
        {isLoading && <div className="p-4 text-center text-gray-500 text-sm">Loading…</div>}
        {isError && (
          <div className="p-4 text-center text-red-600 text-sm">Could not load rides.</div>
        )}
        {rides && filtered.length === 0 && (
          <div className="p-4 text-center text-gray-500 text-sm">
            {rides.length === 0
              ? 'No rides yet. Import or sync some rides.'
              : 'No rides match the filters.'}
          </div>
        )}
        {filtered.map((ride) => (
          <div key={ride.id} ref={(el) => void (refs.current[ride.id] = el)}>
            <RideCard
              ride={ride}
              routeCount={ride.route_id ? (routeCounts.get(ride.route_id) ?? 1) : 0}
              selected={selectedRideId === ride.id}
              onSelect={() => onSelectRide(selectedRideId === ride.id ? null : ride.id)}
              onShowRoute={onShowRoute}
              onDeleted={() => selectedRideId === ride.id && onSelectRide(null)}
            />
          </div>
        ))}
      </div>
    </>
  );
}

function RideCard({
  ride,
  routeCount,
  selected,
  onSelect,
  onShowRoute,
  onDeleted,
}: {
  ride: Ride;
  routeCount: number;
  selected: boolean;
  onSelect(): void;
  onShowRoute(routeId: string): void;
  onDeleted(): void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(ride.title ?? '');

  const update = useMutation({
    mutationFn: (patch: { title?: string; bike_type?: BikeType | null }) =>
      updateRide(ride.id, patch),
    onSuccess: () => invalidateRideData(queryClient),
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const remove = useMutation({
    mutationFn: () => deleteRide(ride.id),
    onSuccess: () => {
      onDeleted();
      return invalidateRideData(queryClient);
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== ride.title) update.mutate({ title: t });
    setEditing(false);
  };

  return (
    <div
      onClick={editing ? undefined : onSelect}
      className={`group p-2.5 rounded-lg cursor-pointer border ${selected ? 'bg-blue-50 border-blue-200' : 'border-transparent hover:bg-gray-50'}`}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          {editing ? (
            <input
              autoFocus
              value={title}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') saveTitle();
                if (e.key === 'Escape') setEditing(false);
              }}
              onBlur={() => setEditing(false)}
              className="w-full px-1 py-0.5 text-sm border border-blue-300 rounded"
              aria-label="Ride title"
            />
          ) : (
            <div className="font-medium text-gray-800 truncate">
              {ride.title ?? 'Untitled ride'}
            </div>
          )}
          {ride.planned_route_name && (
            <div className="text-xs text-blue-700 truncate">Planned: {ride.planned_route_name}</div>
          )}
          <div className="text-xs text-gray-500">
            {formatDate(ride.date, { weekday: true })} {formatTime(ride.start_time)}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          {!editing && (
            <>
              <IconButton
                title="Rename ride"
                onClick={() => {
                  setTitle(ride.title ?? '');
                  setEditing(true);
                }}
                path="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
              <IconButton
                title="Delete ride"
                danger
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete "${ride.title ?? 'this ride'}"?\n\nIts rated sections are deleted too.`
                    )
                  )
                    remove.mutate();
                }}
                path="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </>
          )}
          <select
            value={ride.bike_type ?? ''}
            onChange={(e) =>
              update.mutate({ bike_type: (e.target.value || null) as BikeType | null })
            }
            className={`text-xs rounded-full px-1.5 py-0.5 border-0 text-white ${ride.bike_type ? BIKE[ride.bike_type].badge : 'bg-gray-400'}`}
            title={ride.bike_type ? 'Bike type' : 'Bike type not known yet: pick one'}
            aria-label="Bike type"
          >
            {!ride.bike_type && <option value="">Bike?</option>}
            {BIKE_TYPES.map((t) => (
              <option key={t} value={t}>
                {BIKE[t].label}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-center gap-3 mt-1 text-xs text-gray-500">
        <span>{formatKm(ride.distance_km)}</span>
        <span>{formatElevation(ride.elevation_gain_m)}</span>
        <span>{formatDuration(ride.moving_time_s ?? ride.duration_s)}</span>
        {ride.route_id && routeCount > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowRoute(ride.route_id!);
            }}
            className="ml-auto truncate max-w-[45%] text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-full px-2"
            title={`Part of route "${ride.route_name}" (ridden ${routeCount}×)`}
          >
            ↻ {ride.route_name ?? 'route'} · {routeCount}×
          </button>
        )}
      </div>
    </div>
  );
}

function IconButton({
  title,
  path,
  onClick,
  danger,
}: {
  title: string;
  path: string;
  onClick(): void;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`opacity-0 group-hover:opacity-100 focus:opacity-100 text-gray-400 p-1 ${danger ? 'hover:text-red-500' : 'hover:text-blue-500'}`}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={path} />
      </svg>
    </button>
  );
}
