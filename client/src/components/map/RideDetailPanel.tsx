import { Route as RouteIcon, SquarePen, X } from 'lucide-react';
import { useMemo } from 'react';
import type { RideDetail } from '../../api';
import {
  formatDate,
  formatDuration,
  formatElevation,
  formatKm,
  formatSpeed,
  formatTime,
} from '../../format';
import { BikeChip, RouteName } from '../ui/badges';
import { Button, IconButton } from '../ui/Button';
import { Figure } from '../ui/Metrics';
import { elevationProfile } from './elevation';
import ElevationProfile from './ElevationProfile';
import { deviceNames } from './devices';

/** The selected ride on the map: key figures, elevation profile, devices and actions. */
export default function RideDetailPanel({
  ride,
  showRouteAction,
  onRateSection,
  onShowRoute,
  onClose,
  onHoverPoint,
}: {
  ride: RideDetail;
  /** Offer "Show route" (the ride has a route that isn't shown yet). */
  showRouteAction: boolean;
  onRateSection(): void;
  onShowRoute(routeId: string): void;
  onClose(): void;
  onHoverPoint(index: number | null): void;
}) {
  const profile = useMemo(
    () => elevationProfile(ride.track, ride.elevation),
    [ride.track, ride.elevation]
  );
  const devices = useMemo(() => deviceNames(ride.devices), [ride.devices]);
  const seconds = ride.moving_time_s ?? ride.duration_s;

  return (
    <aside
      aria-label="Selected ride"
      className="animate-pop-in absolute top-15 right-3 z-[1000] w-80 rounded-lg border border-line bg-panel shadow-float"
    >
      <div className="flex items-start gap-2 px-4 pt-3">
        <div className="min-w-0 flex-1">
          <h2 className="line-clamp-2 text-base font-semibold">{ride.title ?? 'Untitled ride'}</h2>
          <div className="tnum mt-0.5 flex items-center gap-2 text-xs text-muted">
            {formatDate(ride.date, { weekday: true })} {formatTime(ride.start_time)}
            <BikeChip type={ride.bike_type} />
          </div>
        </div>
        <IconButton label="Close ride" onClick={onClose} className="-mr-2">
          <X className="size-4" />
        </IconButton>
      </div>

      <dl className="grid grid-cols-4 gap-2 px-4 pt-3">
        <Figure label="Distance" value={formatKm(ride.distance_km)} />
        <Figure label="Time" value={formatDuration(seconds) || '–'} />
        <Figure label="Climb" value={formatElevation(ride.elevation_gain_m)} />
        <Figure label="Speed" value={formatSpeed(ride.distance_km, seconds) || '–'} />
      </dl>

      {profile.length > 1 && (
        <div className="px-4 pt-4">
          <ElevationProfile points={profile} onHover={onHoverPoint} />
        </div>
      )}

      {devices.length > 0 && (
        <details className="group px-4 pt-3 text-xs">
          <summary className="cursor-pointer text-muted select-none hover:text-fg">
            Recorded with {devices.length} device{devices.length === 1 ? '' : 's'}
          </summary>
          <ul className="mt-1.5 space-y-0.5 text-muted">
            {devices.map((d) => (
              <li key={d} className="truncate">
                {d}
              </li>
            ))}
          </ul>
        </details>
      )}

      {ride.route_id && ride.route_name && !showRouteAction && (
        <div className="px-4 pt-3 text-xs text-muted">
          <RouteName name={ride.route_name} />
        </div>
      )}

      <div className="mt-3 flex gap-2 border-t border-line px-4 py-3">
        <Button
          size="sm"
          icon={<SquarePen aria-hidden className="size-3.5" />}
          onClick={onRateSection}
        >
          Rate section
        </Button>
        {showRouteAction && ride.route_id && (
          <Button
            size="sm"
            variant="ghost"
            className="min-w-0"
            icon={<RouteIcon aria-hidden className="size-3.5" />}
            onClick={() => onShowRoute(ride.route_id!)}
            title={ride.route_name ? `Show route "${ride.route_name}"` : 'Show route'}
          >
            Show route
          </Button>
        )}
      </div>
    </aside>
  );
}
