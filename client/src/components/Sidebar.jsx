import { useState, useEffect, useRef, forwardRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getRides, getStats, deleteRide, updateRide } from '../api';

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
  heatmapIntensity,
  onHeatmapIntensityChange,
  heatmapOpacity,
  onHeatmapOpacityChange,
  showSections,
  onShowSectionsChange,
  showAllTracks,
  onShowAllTracksChange,
  trackOpacity,
  onTrackOpacityChange,
  mapSaturation,
  onMapSaturationChange
}) {
  const queryClient = useQueryClient();

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

  // Delete ride mutation
  const deleteMutation = useMutation({
    mutationFn: deleteRide,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      queryClient.invalidateQueries({ queryKey: ['heatmap'] });
      queryClient.invalidateQueries({ queryKey: ['bounds'] });
      queryClient.invalidateQueries({ queryKey: ['stats'] });
      queryClient.invalidateQueries({ queryKey: ['allTracks'] });
      queryClient.invalidateQueries({ queryKey: ['sections'] });
    }
  });

  // Rename ride mutation
  const renameMutation = useMutation({
    mutationFn: ({ id, title }) => updateRide(id, { title }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rides'] });
      queryClient.invalidateQueries({ queryKey: ['allTracks'] });
    }
  });

  const handleDeleteRide = (rideId, rideTitle) => {
    if (window.confirm(`Delete "${rideTitle}"?\n\nThis will also delete all rated sections for this ride.`)) {
      if (selectedRide === rideId) {
        onSelectRide(null);
      }
      deleteMutation.mutate(rideId);
    }
  };

  const handleRenameRide = (rideId, newTitle) => {
    if (newTitle.trim()) {
      renameMutation.mutate({ id: rideId, title: newTitle.trim() });
    }
  };

  // Refs for scrolling to selected ride
  const rideRefs = useRef({});

  // Scroll to selected ride when it changes
  useEffect(() => {
    if (selectedRide && rideRefs.current[selectedRide]) {
      rideRefs.current[selectedRide].scrollIntoView({
        behavior: 'smooth',
        block: 'center'
      });
    }
  }, [selectedRide]);

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
          {showHeatmap && (
            <div className="ml-5 space-y-1">
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Intensity:</span>
                <input
                  type="range"
                  min="10"
                  max="100"
                  step="5"
                  value={heatmapIntensity}
                  onChange={(e) => onHeatmapIntensityChange(parseInt(e.target.value))}
                  className="w-20 h-1.5 accent-blue-500"
                />
                <span className="text-xs text-gray-500 w-8">{heatmapIntensity}%</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-gray-500 w-14">Opacity:</span>
                <input
                  type="range"
                  min="0.1"
                  max="1"
                  step="0.05"
                  value={heatmapOpacity}
                  onChange={(e) => onHeatmapOpacityChange(parseFloat(e.target.value))}
                  className="w-20 h-1.5 accent-blue-500"
                />
                <span className="text-xs text-gray-500 w-8">{Math.round(heatmapOpacity * 100)}%</span>
              </div>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showAllTracks}
              onChange={(e) => onShowAllTracksChange(e.target.checked)}
              className="rounded"
            />
            Show all tracks
          </label>
          {showAllTracks && (
            <div className="flex items-center gap-2 ml-5">
              <span className="text-xs text-gray-500">Opacity:</span>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.05"
                value={trackOpacity}
                onChange={(e) => onTrackOpacityChange(parseFloat(e.target.value))}
                className="w-24 h-1.5 accent-blue-500"
              />
              <span className="text-xs text-gray-500 w-8">{Math.round(trackOpacity * 100)}%</span>
            </div>
          )}
          <div className="flex items-center gap-2 pt-2 border-t mt-2">
            <span className="text-xs text-gray-500">Map color:</span>
            <input
              type="range"
              min="0"
              max="100"
              step="5"
              value={mapSaturation}
              onChange={(e) => onMapSaturationChange(parseInt(e.target.value))}
              className="w-24 h-1.5 accent-blue-500"
            />
            <span className="text-xs text-gray-500 w-8">{mapSaturation}%</span>
          </div>
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
                ref={(el) => { rideRefs.current[ride.id] = el; }}
                ride={ride}
                isSelected={selectedRide === ride.id}
                onClick={() => onSelectRide(selectedRide === ride.id ? null : ride.id)}
                onDelete={() => handleDeleteRide(ride.id, ride.title)}
                onRename={(newTitle) => handleRenameRide(ride.id, newTitle)}
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

const RideCard = forwardRef(function RideCard({ ride, isSelected, onClick, onDelete, onRename }, ref) {
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(ride.title);

  const formattedDate = ride.date
    ? new Date(ride.date).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric'
      })
    : 'Unknown date';

  const handleDelete = (e) => {
    e.stopPropagation();
    onDelete();
  };

  const handleEditClick = (e) => {
    e.stopPropagation();
    setEditTitle(ride.title);
    setIsEditing(true);
  };

  const handleSaveEdit = (e) => {
    e?.stopPropagation();
    if (editTitle.trim() && editTitle.trim() !== ride.title) {
      onRename(editTitle.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = (e) => {
    e?.stopPropagation();
    setEditTitle(ride.title);
    setIsEditing(false);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  return (
    <div
      ref={ref}
      onClick={isEditing ? undefined : onClick}
      className={`group p-3 rounded-lg cursor-pointer transition-colors ${
        isSelected
          ? 'bg-blue-50 border border-blue-200'
          : 'hover:bg-gray-50 border border-transparent'
      }`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1 min-w-0">
          {isEditing ? (
            <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={handleSaveEdit}
                autoFocus
                className="flex-1 min-w-0 px-1 py-0.5 text-sm border border-blue-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          ) : (
            <div className="font-medium text-gray-800 truncate">{ride.title}</div>
          )}
          <div className="text-sm text-gray-500">{formattedDate}</div>
        </div>
        <div className="flex items-center gap-1">
          {!isEditing && (
            <>
              <button
                onClick={handleEditClick}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-500 p-1 transition-opacity"
                title="Rename ride"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
              <button
                onClick={handleDelete}
                className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 transition-opacity"
                title="Delete ride"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            </>
          )}
          <span
            className={`${BIKE_TYPE_COLORS[ride.bike_type]} text-white text-xs px-2 py-0.5 rounded-full`}
          >
            {BIKE_TYPE_LABELS[ride.bike_type]}
          </span>
        </div>
      </div>
      <div className="flex gap-3 mt-1 text-xs text-gray-500">
        <span>{ride.distance_km?.toFixed(1)} km</span>
        <span>{ride.elevation_gain_m} m</span>
      </div>
    </div>
  );
});
