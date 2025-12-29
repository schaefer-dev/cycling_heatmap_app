import { useQuery } from '@tanstack/react-query';
import { getRides, getStats } from '../api';

const BIKE_TYPE_LABELS = {
  road: 'Road',
  gravel: 'Gravel',
  mtb: 'MTB'
};

const BIKE_TYPE_COLORS = {
  road: 'bg-blue-500',
  gravel: 'bg-amber-600',
  mtb: 'bg-green-600'
};

export default function Sidebar({
  onImportClick,
  selectedRide,
  onSelectRide,
  bikeTypeFilter,
  onBikeTypeFilterChange,
  showHeatmap,
  onShowHeatmapChange,
  showSections,
  onShowSectionsChange,
  showAllTracks,
  onShowAllTracksChange
}) {
  // Fetch rides
  const { data: rides, isLoading: ridesLoading } = useQuery({
    queryKey: ['rides', bikeTypeFilter],
    queryFn: () => getRides(bikeTypeFilter)
  });

  // Fetch stats
  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats
  });

  return (
    <div className="w-80 bg-white shadow-lg flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h1 className="text-xl font-bold text-gray-800">Cycling Archive</h1>
        {stats && (
          <div className="text-sm text-gray-500 mt-1">
            {stats.rides.total} rides | {stats.rides.total_distance_km} km
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="p-4 border-b space-y-3">
        <button
          onClick={onImportClick}
          className="w-full bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-lg font-medium transition-colors"
        >
          Import GPX
        </button>

        {/* Bike type filter */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Filter by bike type
          </label>
          <select
            value={bikeTypeFilter || ''}
            onChange={(e) => onBikeTypeFilterChange(e.target.value || null)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
          >
            <option value="">All bikes</option>
            <option value="road">Road</option>
            <option value="gravel">Gravel</option>
            <option value="mtb">MTB</option>
          </select>
        </div>

        {/* Layer toggles */}
        <div className="space-y-2">
          <div className="flex gap-4">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showHeatmap}
                onChange={(e) => onShowHeatmapChange(e.target.checked)}
                className="rounded"
              />
              Heatmap
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showSections}
                onChange={(e) => onShowSectionsChange(e.target.checked)}
                className="rounded"
              />
              Sections
            </label>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAllTracks}
              onChange={(e) => onShowAllTracksChange(e.target.checked)}
              className="rounded"
            />
            Show all tracks
          </label>
        </div>
      </div>

      {/* Rides list */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <h2 className="text-sm font-semibold text-gray-600 px-2 py-1">
            Rides {rides && `(${rides.length})`}
          </h2>
        </div>

        {ridesLoading ? (
          <div className="p-4 text-center text-gray-500">Loading...</div>
        ) : rides?.length === 0 ? (
          <div className="p-4 text-center text-gray-500">
            No rides yet. Import some GPX files!
          </div>
        ) : (
          <div className="space-y-1 px-2 pb-4">
            {rides?.map((ride) => (
              <RideCard
                key={ride.id}
                ride={ride}
                isSelected={selectedRide === ride.id}
                onClick={() => onSelectRide(selectedRide === ride.id ? null : ride.id)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Stats at bottom */}
      {stats && (
        <div className="p-4 border-t bg-gray-50">
          <div className="grid grid-cols-3 gap-2 text-center text-xs">
            <div>
              <div className="font-semibold text-blue-600">{stats.rides.by_type.road}</div>
              <div className="text-gray-500">Road</div>
            </div>
            <div>
              <div className="font-semibold text-amber-600">{stats.rides.by_type.gravel}</div>
              <div className="text-gray-500">Gravel</div>
            </div>
            <div>
              <div className="font-semibold text-green-600">{stats.rides.by_type.mtb}</div>
              <div className="text-gray-500">MTB</div>
            </div>
          </div>
          {stats.sections.total > 0 && (
            <div className="mt-2 pt-2 border-t text-xs text-center text-gray-500">
              {stats.sections.total} rated sections
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function RideCard({ ride, isSelected, onClick }) {
  const formattedDate = ride.date
    ? new Date(ride.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : 'Unknown date';

  return (
    <div
      onClick={onClick}
      className={`p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border border-blue-200'
          : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-gray-800 truncate">{ride.title}</div>
          <div className="text-sm text-gray-500">{formattedDate}</div>
        </div>
        <span
          className={`${BIKE_TYPE_COLORS[ride.bike_type]} text-white text-xs px-2 py-0.5 rounded-full`}
        >
          {BIKE_TYPE_LABELS[ride.bike_type]}
        </span>
      </div>
      <div className="flex gap-3 mt-1 text-xs text-gray-500">
        <span>{ride.distance_km?.toFixed(1)} km</span>
        <span>{ride.elevation_gain_m} m</span>
      </div>
    </div>
  );
}
