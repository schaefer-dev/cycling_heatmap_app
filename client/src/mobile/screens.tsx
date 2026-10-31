import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Route as RouteIcon, Star } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';
import { getRide, getRoute, type Ride } from '../api';
import { deviceNames } from '../components/map/devices';
import { elevationProfile } from '../components/map/elevation';
import ElevationProfile from '../components/map/ElevationProfile';
import { BikeChip, RouteName } from '../components/ui/badges';
import { Figure } from '../components/ui/Metrics';
import { EmptyState, SkeletonRows } from '../components/ui/states';
import { parseRouteRating } from '../domain';
import {
  formatDate,
  formatDuration,
  formatElevation,
  formatKm,
  formatRelative,
  formatSpeed,
  formatTime,
} from '../format';
import { qk } from '../queryKeys';
import { RideLine } from './lists';

/** Back link and title; the whole block also drags the sheet. */
export function ScreenHeader({
  backLabel,
  onBack,
  children,
}: {
  backLabel: string;
  onBack(): void;
  children: ReactNode;
}) {
  return (
    <div data-sheet-drag className="sticky top-0 z-20 touch-none bg-panel px-4 pb-3">
      <button
        type="button"
        onClick={onBack}
        className="-ml-2 inline-flex h-10 max-w-full items-center gap-0.5 rounded-md pr-2 text-base text-signal active:bg-raised"
      >
        <ChevronLeft aria-hidden className="size-5 shrink-0" />
        <span className="truncate">{backLabel}</span>
      </button>
      {children}
    </div>
  );
}

function BigStars({ count }: { count: number }) {
  return (
    <span className="flex gap-1 text-heat-3" aria-label={`${count} stars`}>
      {Array.from({ length: count }, (_, i) => (
        <Star key={i} aria-hidden className="size-4 fill-current" />
      ))}
    </span>
  );
}

function RideRows({
  rides,
  onOpen,
  showRoute,
}: {
  rides: Ride[];
  onOpen(r: Ride): void;
  showRoute: boolean;
}) {
  return (
    <ul>
      {rides.map((r) => (
        <li key={r.id}>
          <button
            type="button"
            onClick={() => onOpen(r)}
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2.5 text-left active:bg-raised"
          >
            <span className="min-w-0 flex-1">
              <RideLine ride={r} showRoute={showRoute} />
            </span>
            <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function RouteScreen({
  routeId,
  backLabel,
  onBack,
  onOpenRide,
}: {
  routeId: string;
  backLabel: string;
  onBack(): void;
  onOpenRide(ride: Ride): void;
}) {
  const {
    data: route,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.route(routeId),
    queryFn: () => getRoute(routeId),
  });
  const rating = parseRouteRating(route?.name);
  const name = (rating ? rating.rest : route?.name) || 'Unnamed route';
  const rides = useMemo(
    () =>
      [...(route?.rides ?? [])].sort((a, b) =>
        (b.start_time ?? b.date ?? '').localeCompare(a.start_time ?? a.date ?? '')
      ),
    [route]
  );

  return (
    <>
      <ScreenHeader backLabel={backLabel} onBack={onBack}>
        {route && (
          <>
            {rating && (
              <span className="mb-1.5 flex items-center gap-2">
                <BigStars count={rating.stars} />
                {rating.kind && (
                  <span className="text-sm text-muted">
                    {rating.kind === 'gravel' ? 'Gravel' : 'Road'}
                  </span>
                )}
              </span>
            )}
            <h2 className="text-xl font-semibold text-fg">{name}</h2>
            {route.planned_route_name && (
              <p className="mt-0.5 truncate text-sm text-signal/80">
                Planned: {route.planned_route_name}
              </p>
            )}
            <dl className="mt-3 grid grid-cols-4 gap-2">
              <Figure label="Distance" value={formatKm(route.avg_distance_km, 0)} />
              <Figure label="Climb" value={formatElevation(route.avg_elevation_gain_m)} />
              <Figure label="Ridden" value={`${route.ride_count}×`} />
              <Figure label="Last" value={formatRelative(route.last_ridden) || '–'} />
            </dl>
          </>
        )}
      </ScreenHeader>
      {isLoading && <SkeletonRows rows={4} />}
      {isError && <EmptyState tone="danger">Could not load this route.</EmptyState>}
      {route && (
        <section aria-label="Rides of this route" className="border-t border-line pb-4">
          <h3 className="px-4 pt-3 pb-1 text-sm font-medium text-muted">
            {rides.length === 1 ? '1 ride' : `${rides.length} rides`}
          </h3>
          <RideRows rides={rides} onOpen={onOpenRide} showRoute={false} />
        </section>
      )}
    </>
  );
}

export function RideScreen({
  rideId,
  backLabel,
  onBack,
  onShowRoute,
  onScrub,
}: {
  rideId: string;
  backLabel: string;
  onBack(): void;
  /** Offered when the ride belongs to a route that isn't the page we came from. */
  onShowRoute: ((routeId: string) => void) | null;
  onScrub(index: number | null): void;
}) {
  const {
    data: ride,
    isLoading,
    isError,
  } = useQuery({
    queryKey: qk.ride(rideId),
    queryFn: () => getRide(rideId),
  });
  const profile = useMemo(() => (ride ? elevationProfile(ride.track, ride.elevation) : []), [ride]);
  const devices = useMemo(() => (ride ? deviceNames(ride.devices) : []), [ride]);
  const seconds = ride ? (ride.moving_time_s ?? ride.duration_s) : null;

  return (
    <>
      <ScreenHeader backLabel={backLabel} onBack={onBack}>
        {ride && (
          <>
            <h2 className="line-clamp-2 text-xl font-semibold text-fg">
              {ride.title ?? 'Untitled ride'}
            </h2>
            <p className="tnum mt-1 flex items-center gap-2 text-sm text-muted">
              {formatDate(ride.date ?? ride.start_time, { weekday: true })}{' '}
              {formatTime(ride.start_time)}
              <BikeChip type={ride.bike_type} />
            </p>
            <dl className="mt-3 grid grid-cols-4 gap-2">
              <Figure label="Distance" value={formatKm(ride.distance_km)} />
              <Figure label="Time" value={formatDuration(seconds) || '–'} />
              <Figure label="Climb" value={formatElevation(ride.elevation_gain_m)} />
              <Figure label="Speed" value={formatSpeed(ride.distance_km, seconds) || '–'} />
            </dl>
          </>
        )}
      </ScreenHeader>
      {isLoading && <SkeletonRows rows={3} />}
      {isError && <EmptyState tone="danger">Could not load this ride.</EmptyState>}
      {ride && (
        <div className="space-y-4 border-t border-line px-4 pt-4 pb-6">
          {profile.length > 1 && (
            <div>
              <p className="mb-1 text-sm text-muted">
                Elevation. Slide along it to follow the ride on the map.
              </p>
              <ElevationProfile points={profile} onHover={onScrub} />
            </div>
          )}
          {ride.route_id && onShowRoute ? (
            <button
              type="button"
              onClick={() => onShowRoute(ride.route_id!)}
              className="flex h-12 w-full items-center gap-3 rounded-md border border-line bg-raised px-3 text-left active:bg-active"
            >
              <RouteIcon aria-hidden className="size-4 shrink-0 text-signal" />
              <span className="min-w-0 flex-1">
                <span className="block text-xs text-muted">Show route</span>
                <RouteName name={ride.route_name} className="text-sm font-medium text-fg" />
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-faint" />
            </button>
          ) : (
            ride.route_name && <RouteName name={ride.route_name} className="text-sm text-muted" />
          )}
          {devices.length > 0 && (
            <div className="text-sm">
              <h3 className="text-muted">Recorded with</h3>
              <ul className="mt-1 space-y-0.5 text-fg">
                {devices.map((d) => (
                  <li key={d} className="truncate">
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export function NearbyScreen({
  rides,
  onBack,
  onOpenRide,
}: {
  rides: Ride[];
  onBack(): void;
  onOpenRide(ride: Ride): void;
}) {
  return (
    <>
      <ScreenHeader backLabel="Back" onBack={onBack}>
        <h2 className="text-xl font-semibold text-fg">
          {rides.length === 1 ? '1 ride passes here' : `${rides.length} rides pass here`}
        </h2>
      </ScreenHeader>
      <div className="border-t border-line pb-4">
        <RideRows rides={rides} onOpen={onOpenRide} showRoute />
      </div>
    </>
  );
}
