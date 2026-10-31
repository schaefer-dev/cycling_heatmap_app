import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRightLeft,
  ChevronLeft,
  GitMerge,
  Pencil,
  Repeat,
  SquareDashed,
  Unlink,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  errorMessage,
  getRoute,
  mergeRoutes,
  moveRideToRoute,
  renameRoute,
  unlinkPlannedRoute,
  type Ride,
  type RouteSummary,
} from '../../api';
import { BIKE } from '../../domain';
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
import { usePreviewHandlers } from '../../preview';
import { invalidateRouteData, qk } from '../../queryKeys';
import { useToast } from '../Toast';
import { RouteName } from '../ui/badges';
import { Button } from '../ui/Button';
import { useConfirm } from '../ui/Confirm';
import { cx } from '../ui/cx';
import { inputClass } from '../ui/fields';
import { Menu } from '../ui/Menu';
import RoutePicker from '../ui/RoutePicker';
import { Figure } from '../ui/Metrics';
import { EmptyState, SkeletonRows } from '../ui/states';

/** Below this share of a ride on its route, the share is highlighted. */
const OFF_ROUTE = 0.97;

export default function RouteDetail({
  routeId,
  summary,
  allRoutes,
  selectedRideId,
  backLabel = 'Routes',
  onBack,
  onSelectRoute,
  onSelectRide,
}: {
  routeId: string;
  /** From the route list, so the header shows before the detail has loaded. */
  summary: RouteSummary | undefined;
  allRoutes: RouteSummary[];
  selectedRideId: string | null;
  /** Name of the list the back button returns to. */
  backLabel?: string;
  onBack(): void;
  onSelectRoute(routeId: string | null): void;
  onSelectRide(rideId: string): void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const confirm = useConfirm();
  const {
    data: detail,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.route(routeId),
    queryFn: () => getRoute(routeId),
  });
  const route: RouteSummary | undefined = detail ?? summary;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [picker, setPicker] = useState<{ kind: 'merge' } | { kind: 'move'; ride: Ride } | null>(
    null
  );

  const onDone = () => invalidateRouteData(queryClient);
  const rename = useMutation({
    mutationFn: (n: string) => renameRoute(routeId, n),
    onSuccess: () => {
      setEditing(false);
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const unlink = useMutation({
    mutationFn: () => unlinkPlannedRoute(routeId),
    onSuccess: () => {
      toast.show('Planned route label removed', 'success');
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const merge = useMutation({
    mutationFn: (into: string) => mergeRoutes(routeId, into),
    onSuccess: (_, into) => {
      toast.show('Routes merged', 'success');
      // This route no longer exists: continue with the one it was merged into.
      onSelectRoute(into);
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });
  const move = useMutation({
    mutationFn: ({ rideId, target }: { rideId: string; target: string | null }) =>
      moveRideToRoute(rideId, target),
    onSuccess: () => {
      toast.show('Ride moved', 'success');
      return onDone();
    },
    onError: (e) => toast.show(errorMessage(e), 'error'),
  });

  const otherRoutes = useMemo(
    () =>
      allRoutes
        .filter((r) => r.id !== routeId)
        .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '')),
    [allRoutes, routeId]
  );

  const rowRefs = useRef<Record<string, HTMLLIElement | null>>({});
  useEffect(() => {
    if (selectedRideId)
      rowRefs.current[selectedRideId]?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [selectedRideId, detail]);

  const pickRoute = async (targetId: string) => {
    const current = picker;
    setPicker(null);
    if (!current) return;
    if (current.kind === 'move') {
      move.mutate({ rideId: current.ride.id, target: targetId });
      return;
    }
    const target = otherRoutes.find((r) => r.id === targetId);
    if (!target || !route) return;
    const ok = await confirm({
      title: 'Merge routes?',
      message: `Merge all ${route.ride_count} ride(s) into "${target.name}"?`,
      confirmLabel: 'Merge',
    });
    if (ok) merge.mutate(target.id);
  };

  return (
    <section aria-label="Route details" className="animate-slide-in flex min-h-0 flex-1 flex-col">
      <div className="space-y-3 border-b border-line px-4 pt-2 pb-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          icon={<ChevronLeft aria-hidden className="size-4" />}
          className="-ml-2.5"
        >
          {backLabel}
        </Button>

        {editing ? (
          <form
            className="flex gap-2"
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
              className={cx(inputClass, 'min-w-0 flex-1')}
              aria-label="Route name"
            />
            <Button type="submit" variant="primary" size="sm" className="h-8">
              Save
            </Button>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </form>
        ) : (
          <h2 className="text-xl font-semibold tracking-tight">
            <RouteName name={route?.name} className="[&>span:last-child]:whitespace-normal" />
          </h2>
        )}

        {route?.planned_route_name && (
          <div className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate text-signal/80">
              Planned: {route.planned_route_name}
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => unlink.mutate()}
              disabled={unlink.isPending}
              icon={<Unlink aria-hidden className="size-3.5" />}
              title={`Remove the planned route label "${route.planned_route_name}" (the name stays)`}
            >
              Unlink planned
            </Button>
          </div>
        )}

        {route && (
          <dl className="grid grid-cols-4 gap-2">
            <Figure label="Distance" value={formatKm(route.avg_distance_km, 0)} />
            <Figure label="Climb" value={formatElevation(route.avg_elevation_gain_m)} />
            <Figure label="Rides" value={String(route.ride_count)} />
            <Figure
              label="First ridden"
              value={formatDate(route.first_ridden).replace(/^\d+ /, '')}
            />
          </dl>
        )}

        {!editing && route && (
          <div className="flex gap-2">
            <Button
              size="sm"
              icon={<Pencil aria-hidden className="size-3.5" />}
              onClick={() => {
                setName(route.name ?? '');
                setEditing(true);
              }}
            >
              Rename
            </Button>
            <Button
              size="sm"
              icon={<GitMerge aria-hidden className="size-3.5" />}
              onClick={() => setPicker({ kind: 'merge' })}
              disabled={otherRoutes.length === 0 || merge.isPending}
            >
              Merge into…
            </Button>
          </div>
        )}
      </div>

      <div className="flex items-baseline px-4 pt-3 pb-1 text-xs text-faint">
        <span className="flex-1">Rides, newest first</span>
        {route?.last_ridden && <span>last {formatRelative(route.last_ridden)}</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2">
        {isLoading && <SkeletonRows rows={4} />}
        {isError && (
          <EmptyState
            tone="danger"
            action={
              <Button size="sm" onClick={onBack}>
                Back to routes
              </Button>
            }
          >
            This route could not be loaded. It may have been merged or removed.
          </EmptyState>
        )}
        <ul className="space-y-px">
          {detail?.rides.map((ride) => (
            <RouteRideRow
              key={ride.id}
              rowRef={(el) => void (rowRefs.current[ride.id] = el)}
              ride={ride}
              isReference={detail.reference_ride_id === ride.id}
              selected={selectedRideId === ride.id}
              onSelect={() => onSelectRide(ride.id)}
              soleRide={detail.rides.length === 1}
              canMove={otherRoutes.length > 0}
              onMove={() => setPicker({ kind: 'move', ride })}
              onMoveToOwn={() => move.mutate({ rideId: ride.id, target: null })}
            />
          ))}
        </ul>
      </div>

      {picker && (
        <RoutePicker
          title={
            picker.kind === 'merge' ? 'Merge into another route' : 'Move ride to another route'
          }
          routes={otherRoutes}
          onPick={(id) => void pickRoute(id)}
          onClose={() => setPicker(null)}
        />
      )}
    </section>
  );
}

function RouteRideRow({
  ride,
  rowRef,
  isReference,
  selected,
  onSelect,
  soleRide,
  canMove,
  onMove,
  onMoveToOwn,
}: {
  ride: Ride;
  rowRef(el: HTMLLIElement | null): void;
  isReference: boolean;
  selected: boolean;
  onSelect(): void;
  soleRide: boolean;
  canMove: boolean;
  onMove(): void;
  onMoveToOwn(): void;
}) {
  const offRoute =
    ride.route_similarity != null && ride.route_similarity < OFF_ROUTE && !isReference;
  const seconds = ride.moving_time_s ?? ride.duration_s;
  const preview = usePreviewHandlers({ kind: 'ride', id: ride.id });

  return (
    <li
      {...preview}
      ref={rowRef}
      className={cx(
        'group relative flex items-start rounded-md transition-colors',
        selected ? 'bg-active' : 'hover:bg-raised'
      )}
    >
      {selected && (
        <span aria-hidden className="absolute top-2 bottom-2 left-0 w-0.5 rounded-full bg-signal" />
      )}
      <button
        onClick={onSelect}
        aria-pressed={selected}
        className="min-w-0 flex-1 py-2 pr-1 pl-3 text-left"
      >
        <span className="tnum flex items-center gap-2 text-xs">
          <span className="w-[6.75rem] shrink-0 font-medium text-fg">
            {formatDate(ride.date, { weekday: true })}
          </span>
          <span className="w-10 shrink-0 text-faint">{formatTime(ride.start_time)}</span>
          <span className="w-14 shrink-0 text-right text-fg">{formatKm(ride.distance_km)}</span>
          <span className="w-12 shrink-0 text-right text-muted">{formatDuration(seconds)}</span>
          {ride.route_direction === 'reverse' && (
            <span title="Ridden in reverse direction" className="ml-auto text-muted">
              <Repeat aria-hidden className="size-3" />
            </span>
          )}
        </span>
        <span className="mt-0.5 flex items-baseline gap-3 text-xs text-faint">
          <span className="min-w-0 flex-1 truncate text-muted">
            {ride.title ?? 'Untitled ride'}
          </span>
          <span className="shrink-0">
            {ride.bike_type ? BIKE[ride.bike_type].label : 'Bike unassigned'}
          </span>
          {formatSpeed(ride.distance_km, seconds) && (
            <span className="tnum shrink-0">{formatSpeed(ride.distance_km, seconds)}</span>
          )}
          {isReference ? (
            <span
              title="Reference ride for this route"
              className="w-9 shrink-0 rounded-sm bg-raised text-center text-2xs text-muted"
            >
              ref
            </span>
          ) : (
            <span
              title="Share of the ride on the route"
              className={cx(
                'tnum w-9 shrink-0 text-right',
                offRoute ? 'font-semibold text-warn' : 'text-faint'
              )}
            >
              {formatPercent(ride.route_similarity)}
            </span>
          )}
        </span>
      </button>
      <div className="pt-1.5 pr-1">
        <Menu
          label="Ride actions"
          className="opacity-60 group-hover:opacity-100 focus-visible:opacity-100 aria-expanded:opacity-100"
          items={[
            {
              label: 'Move to another route…',
              icon: <ArrowRightLeft />,
              hidden: !canMove,
              onSelect: onMove,
            },
            {
              label: 'Move to its own route',
              icon: <SquareDashed />,
              hidden: soleRide,
              onSelect: onMoveToOwn,
            },
          ]}
        />
      </div>
    </li>
  );
}
