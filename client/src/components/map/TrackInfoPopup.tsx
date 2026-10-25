import type { Ride } from '../../api';
import { formatDate, formatKm } from '../../format';
import { BikeChip, RouteName } from '../ui/badges';

/** "N rides at this location" list shown when clicking the map. */
export default function TrackInfoPopup({
  rides,
  onPreview,
}: {
  rides: Ride[];
  onPreview(ride: Ride): void;
}) {
  const dated = rides
    .filter((r) => r.date)
    .map((r) => r.date!)
    .sort();
  return (
    <div className="w-[17rem]">
      <div className="pr-5 text-sm font-semibold text-fg">
        {rides.length} ride{rides.length === 1 ? '' : 's'} at this location
      </div>
      {dated.length > 1 && (
        <div className="tnum mt-0.5 text-xs text-muted">
          First {formatDate(dated[0])}, last {formatDate(dated[dated.length - 1])}
        </div>
      )}
      <ul className="-mx-2 mt-2 max-h-[240px] space-y-px overflow-y-auto border-t border-line pt-1.5">
        {rides.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onPreview(r)}
              className="w-full rounded-md px-2 py-1.5 text-left hover:bg-raised"
            >
              <span className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium text-fg">
                  {r.title ?? 'Untitled ride'}
                </span>
                <BikeChip type={r.bike_type} />
              </span>
              <span className="tnum mt-0.5 flex min-w-0 gap-3 text-xs text-muted">
                <span className="shrink-0">{formatDate(r.date, { weekday: true })}</span>
                <span className="shrink-0">{formatKm(r.distance_km)}</span>
                {r.route_name && <RouteName name={r.route_name} className="text-faint" />}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
