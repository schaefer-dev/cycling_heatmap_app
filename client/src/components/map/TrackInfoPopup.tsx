import type { Ride } from '../../api';
import { BIKE } from '../../domain';
import { formatDate, formatKm } from '../../format';

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
    <div className="min-w-[220px] max-w-[300px]">
      <div className="font-semibold text-gray-800 mb-2 pb-2 border-b">
        {rides.length} ride{rides.length === 1 ? '' : 's'} at this location
      </div>
      {dated.length > 1 && (
        <div className="text-xs text-gray-500 mb-2 pb-2 border-b">
          First {formatDate(dated[0])} · last {formatDate(dated[dated.length - 1])}
        </div>
      )}
      <ul className="max-h-[220px] overflow-y-auto space-y-1.5">
        {rides.map((r) => (
          <li key={r.id}>
            <button
              onClick={() => onPreview(r)}
              className="w-full text-left hover:bg-gray-50 rounded px-1 py-0.5"
            >
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-700 truncate flex-1">
                  {r.title ?? 'Untitled ride'}
                </span>
                <span
                  className={`text-[10px] px-1.5 rounded text-white ${r.bike_type ? BIKE[r.bike_type].badge : 'bg-gray-400'}`}
                >
                  {r.bike_type ? BIKE[r.bike_type].label : '?'}
                </span>
              </div>
              <div className="text-xs text-gray-500 truncate">
                {formatDate(r.date, { weekday: true })} · {formatKm(r.distance_km)}
                {r.route_name ? ` · ${r.route_name}` : ''}
              </div>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
