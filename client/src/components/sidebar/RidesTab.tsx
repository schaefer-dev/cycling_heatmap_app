import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Pencil, Trash2 } from 'lucide-react';
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
import type { BikeType } from '../../domain';
import { formatDate, formatDuration, formatElevation, formatKm, formatTime } from '../../format';
import { invalidateRideData, qk } from '../../queryKeys';
import { useToast } from '../Toast';
import { BikeSelect, RideCount, RouteName } from '../ui/badges';
import { useConfirm } from '../ui/Confirm';
import { cx } from '../ui/cx';
import { inputClass, SearchInput } from '../ui/fields';
import { Menu } from '../ui/Menu';
import { Metrics } from '../ui/Metrics';
import { EmptyState, SkeletonRows } from '../ui/states';

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
  const maxCount = useMemo(() => Math.max(1, ...(routes ?? []).map((r) => r.ride_count)), [routes]);

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
      <div className="space-y-2 border-b border-line p-3">
        <SearchInput
          placeholder="Search rides or routes…"
          aria-label="Search rides or routes"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex items-center gap-2 text-xs text-muted">
          <span>Distance</span>
          <input
            type="number"
            min="0"
            placeholder="min"
            value={minKm}
            onChange={(e) => setMinKm(e.target.value)}
            className={cx(inputClass, 'tnum h-7 w-16 px-2 text-xs')}
            aria-label="Minimum distance"
          />
          <span aria-hidden>–</span>
          <input
            type="number"
            min="0"
            placeholder="max"
            value={maxKm}
            onChange={(e) => setMaxKm(e.target.value)}
            className={cx(inputClass, 'tnum h-7 w-16 px-2 text-xs')}
            aria-label="Maximum distance"
          />
          <span>km</span>
          {rides && (
            <span className="tnum ml-auto text-faint">
              {filtered.length} of {rides.length}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-1.5">
        {isLoading && <SkeletonRows />}
        {isError && (
          <EmptyState tone="danger">Could not load rides. Is the server running?</EmptyState>
        )}
        {rides && filtered.length === 0 && (
          <EmptyState icon={<Bike />}>
            {rides.length === 0
              ? 'No rides yet. Import GPX or FIT files, or connect Garmin or Hammerhead under Sources.'
              : 'No rides match the filters.'}
          </EmptyState>
        )}
        {filtered.map((ride) => (
          <div key={ride.id} ref={(el) => void (refs.current[ride.id] = el)}>
            <RideCard
              ride={ride}
              routeCount={ride.route_id ? (routeCounts.get(ride.route_id) ?? 1) : 0}
              maxCount={maxCount}
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
  maxCount,
  selected,
  onSelect,
  onShowRoute,
  onDeleted,
}: {
  ride: Ride;
  routeCount: number;
  maxCount: number;
  selected: boolean;
  onSelect(): void;
  onShowRoute(routeId: string): void;
  onDeleted(): void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
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
      toast.show('Ride deleted', 'success');
      return invalidateRideData(queryClient);
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const saveTitle = () => {
    const t = title.trim();
    if (t && t !== ride.title) update.mutate({ title: t });
    setEditing(false);
  };

  const askDelete = async () => {
    const ok = await confirm({
      title: `Delete "${ride.title ?? 'this ride'}"?`,
      message: 'Its rated sections are deleted too.',
      confirmLabel: 'Delete ride',
      danger: true,
    });
    if (ok) remove.mutate();
  };

  return (
    // The whole card selects the ride on click; the title button makes it keyboard reachable.
    <div
      onClick={editing ? undefined : onSelect}
      className={cx(
        'group relative cursor-pointer rounded-md py-2.5 pr-1.5 pl-3 transition-colors',
        selected ? 'bg-active' : 'hover:bg-raised'
      )}
    >
      {selected && (
        <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-signal" />
      )}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
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
              className={cx(inputClass, 'h-7 w-full')}
              aria-label="Ride title"
            />
          ) : (
            <button
              type="button"
              aria-pressed={selected}
              className="block w-full truncate text-left text-sm font-medium text-fg"
            >
              {ride.title ?? 'Untitled ride'}
            </button>
          )}
          <div className="tnum text-xs text-faint">
            {formatDate(ride.date, { weekday: true })} {formatTime(ride.start_time)}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
          <BikeSelect value={ride.bike_type} onChange={(v) => update.mutate({ bike_type: v })} />
          <Menu
            label="Ride actions"
            className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
            items={[
              {
                label: 'Rename',
                icon: <Pencil />,
                onSelect: () => {
                  setTitle(ride.title ?? '');
                  setEditing(true);
                },
              },
              { label: 'Delete', icon: <Trash2 />, danger: true, onSelect: () => void askDelete() },
            ]}
          />
        </div>
      </div>
      {ride.planned_route_name && (
        <div className="truncate text-xs text-signal/80">Planned: {ride.planned_route_name}</div>
      )}
      <div className="mt-1 flex items-center gap-3 pr-1.5">
        <Metrics
          className="shrink-0"
          items={[
            formatKm(ride.distance_km),
            formatElevation(ride.elevation_gain_m),
            formatDuration(ride.moving_time_s ?? ride.duration_s),
          ]}
        />
        {ride.route_id && routeCount > 1 && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onShowRoute(ride.route_id!);
            }}
            className="-my-0.5 ml-auto flex min-w-0 items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs text-muted hover:bg-panel hover:text-fg"
            title={`Part of route "${ride.route_name}" (ridden ${routeCount}×)`}
          >
            <RouteName name={ride.route_name ?? 'route'} className="min-w-0" />
            <RideCount count={routeCount} max={maxCount} />
          </button>
        )}
      </div>
    </div>
  );
}
