import { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, Popup, useMap, useMapEvents } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { getHeatmapData, getMapBounds, getRide, getSections, getAllTracks, getRidesNearPoint } from '../api';
import HeatmapLayer from './HeatmapLayer';
import SectionRatingPanel from './SectionRatingPanel';
import SectionDetailsPanel from './SectionDetailsPanel';

const RATING_COLORS = {
  excellent: '#22c55e',
  good: '#84cc16',
  challenging: '#eab308',
  hard: '#f97316',
  unridable: '#ef4444'
};

// Component to fit map to bounds
function FitBounds({ bounds }) {
  const map = useMap();

  useEffect(() => {
    if (bounds) {
      map.fitBounds([bounds.southwest, bounds.northeast], { padding: [20, 20] });
    }
  }, [map, bounds]);

  return null;
}

// Component to fit to a specific ride
function FitToRide({ trackPoints }) {
  const map = useMap();

  useEffect(() => {
    if (trackPoints && trackPoints.length > 0) {
      const lats = trackPoints.map(p => p.lat);
      const lngs = trackPoints.map(p => p.lng);
      const bounds = [
        [Math.min(...lats), Math.min(...lngs)],
        [Math.max(...lats), Math.max(...lngs)]
      ];
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [map, trackPoints]);

  return null;
}

// Component to create custom map panes with proper z-index
function MapPanes() {
  const map = useMap();

  useEffect(() => {
    // Create panes if they don't exist
    if (!map.getPane('tracksPane')) {
      const tracksPane = map.createPane('tracksPane');
      tracksPane.style.zIndex = 401;
    }
    if (!map.getPane('sectionsPane')) {
      const sectionsPane = map.createPane('sectionsPane');
      sectionsPane.style.zIndex = 410;
    }
  }, [map]);

  return null;
}

// Find closest point on track to a clicked location
function findClosestPoint(clickLat, clickLng, trackPoints) {
  let closestIndex = 0;
  let closestDistance = Infinity;

  for (let i = 0; i < trackPoints.length; i++) {
    const p = trackPoints[i];
    const dist = Math.sqrt(
      Math.pow(p.lat - clickLat, 2) + Math.pow(p.lng - clickLng, 2)
    );
    if (dist < closestDistance) {
      closestDistance = dist;
      closestIndex = i;
    }
  }

  return {
    index: closestIndex,
    lat: trackPoints[closestIndex].lat,
    lng: trackPoints[closestIndex].lng
  };
}

const BIKE_TYPE_TRACK_COLORS = {
  road: '#3b82f6',    // blue
  gravel: '#d97706',  // amber
  mtb: '#16a34a'      // green
};

const BIKE_TYPE_LABELS = {
  road: 'Road',
  gravel: 'Gravel',
  mtb: 'MTB'
};

// Find all tracks that pass near a given point
function findTracksNearPoint(lat, lng, allTracks, threshold = 0.0003) {
  const matchingTracks = [];

  for (const track of allTracks) {
    for (const point of track.track) {
      const dist = Math.sqrt(
        Math.pow(point[0] - lat, 2) + Math.pow(point[1] - lng, 2)
      );
      if (dist < threshold) {
        matchingTracks.push(track);
        break; // Found a match, no need to check more points
      }
    }
  }

  // Sort by date (newest first)
  return matchingTracks.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(b.date) - new Date(a.date);
  });
}

export default function Map({
  selectedRide,
  bikeTypeFilter,
  showHeatmap,
  heatmapIntensity,
  heatmapOpacity,
  showSections,
  showAllTracks,
  trackOpacity,
  mapSaturation,
  onSelectRide
}) {
  const mapRef = useRef(null);
  const [isSelectingSection, setIsSelectingSection] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);
  const [selectedSection, setSelectedSection] = useState(null);
  const [trackInfoPopup, setTrackInfoPopup] = useState(null); // { lat, lng, tracks: [] }

  // Fetch map bounds
  const { data: bounds } = useQuery({
    queryKey: ['bounds', bikeTypeFilter],
    queryFn: () => getMapBounds(bikeTypeFilter)
  });

  // Fetch heatmap data
  const { data: heatmapData } = useQuery({
    queryKey: ['heatmap', bikeTypeFilter],
    queryFn: () => getHeatmapData(bikeTypeFilter),
    enabled: showHeatmap
  });

  // Fetch selected ride details
  const { data: rideData } = useQuery({
    queryKey: ['ride', selectedRide],
    queryFn: () => getRide(selectedRide),
    enabled: !!selectedRide
  });

  // Fetch all sections
  const { data: sections } = useQuery({
    queryKey: ['sections', bikeTypeFilter],
    queryFn: () => getSections(bikeTypeFilter ? { bike_type: bikeTypeFilter } : {}),
    enabled: showSections
  });

  // Fetch all tracks - used for both "show all tracks" display and click detection
  const { data: allTracks } = useQuery({
    queryKey: ['allTracks', bikeTypeFilter],
    queryFn: () => getAllTracks(bikeTypeFilter)
  });

  // Convert ride track to polyline positions
  const rideTrack = useMemo(() => {
    if (!rideData?.trackPoints) return null;
    return rideData.trackPoints.map(p => [p.lat, p.lng]);
  }, [rideData]);

  // Get section track between start and end points
  const sectionTrack = useMemo(() => {
    if (!startPoint || !endPoint || !rideData?.trackPoints) return null;
    const start = Math.min(startPoint.index, endPoint.index);
    const end = Math.max(startPoint.index, endPoint.index);
    return rideData.trackPoints.slice(start, end + 1).map(p => [p.lat, p.lng]);
  }, [startPoint, endPoint, rideData]);

  // Reset section selection when ride changes
  useEffect(() => {
    setIsSelectingSection(false);
    setStartPoint(null);
    setEndPoint(null);
  }, [selectedRide]);

  const handleStartSelection = () => {
    setIsSelectingSection(true);
    setStartPoint(null);
    setEndPoint(null);
  };

  const handleCancelSelection = () => {
    setIsSelectingSection(false);
    setStartPoint(null);
    setEndPoint(null);
  };

  const handleSaveSection = () => {
    setIsSelectingSection(false);
    setStartPoint(null);
    setEndPoint(null);
  };

  // Handle click on a track or heatmap to show info popup
  const handleTrackClick = useCallback((e, clickedTrack) => {
    if (!allTracks) return;

    const { lat, lng } = e.latlng;
    const matchingTracks = findTracksNearPoint(lat, lng, allTracks);

    if (matchingTracks.length > 0) {
      setTrackInfoPopup({
        lat,
        lng,
        tracks: matchingTracks
      });
    }
  }, [allTracks]);

  // Handle general map click (for heatmap clicks)
  const handleMapClick = useCallback(async (e) => {
    if (isSelectingSection) return;

    const { lat, lng } = e.latlng;

    try {
      // Use backend API to find rides near the clicked point (uses full track_points)
      const rides = await getRidesNearPoint(lat, lng, bikeTypeFilter);

      if (rides.length > 0) {
        setTrackInfoPopup({
          lat,
          lng,
          tracks: rides
        });
      }
    } catch (error) {
      console.error('Error finding rides near point:', error);
    }
  }, [isSelectingSection, bikeTypeFilter]);

  // Default center (will be overridden by bounds)
  const defaultCenter = bounds?.center || [49.23, 7.03];
  const defaultZoom = 12;

  // Calculate grayscale value (0% saturation = 100% grayscale)
  const grayscaleValue = 100 - mapSaturation;

  return (
    <>
      {/* Dynamic style for map tile saturation */}
      <style>
        {`.leaflet-tile-pane {
          filter: grayscale(${grayscaleValue}%);
        }`}
      </style>
      <MapContainer
        center={defaultCenter}
        zoom={defaultZoom}
        className="h-full w-full"
        ref={mapRef}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Create custom panes for proper z-index layering */}
        <MapPanes />

        {/* General click handler for heatmap/map clicks */}
        {!isSelectingSection && (
          <GeneralMapClickHandler onMapClick={handleMapClick} />
        )}

        {/* Fit to bounds on load */}
        {bounds && !selectedRide && <FitBounds bounds={bounds} />}

        {/* Fit to selected ride */}
        {selectedRide && rideData?.trackPoints && (
          <FitToRide trackPoints={rideData.trackPoints} />
        )}

        {/* Heatmap layer */}
        {showHeatmap && heatmapData && heatmapData.length > 0 && (
          <HeatmapLayer points={heatmapData} intensity={heatmapIntensity} opacity={heatmapOpacity} />
        )}

        {/* All tracks layer */}
        {showAllTracks && allTracks && allTracks.map(track => (
          <Polyline
            key={track.id}
            positions={track.track}
            pane="tracksPane"
            pathOptions={{
              color: BIKE_TYPE_TRACK_COLORS[track.bike_type] || '#888',
              weight: 3,
              opacity: trackOpacity
            }}
            eventHandlers={{
              click: (e) => {
                e.originalEvent.stopPropagation();
                handleTrackClick(e, track);
              }
            }}
          />
        ))}

        {/* Track info popup */}
        {trackInfoPopup && (
          <Popup
            position={[trackInfoPopup.lat, trackInfoPopup.lng]}
            onClose={() => setTrackInfoPopup(null)}
          >
            <TrackInfoContent
              tracks={trackInfoPopup.tracks}
              selectedRide={selectedRide}
              onPreviewRide={(rideId) => {
                onSelectRide(rideId);
                setTrackInfoPopup(null);
              }}
            />
          </Popup>
        )}

        {/* Selected ride track - with glow effect for visibility */}
        {selectedRide && rideTrack && (
          <>
            {/* Glow/outline layer */}
            <Polyline
              positions={rideTrack}
              pathOptions={{
                color: '#ffffff',
                weight: 10,
                opacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
            {/* Main track layer */}
            <Polyline
              positions={rideTrack}
              pathOptions={{
                color: '#3b82f6',
                weight: 6,
                opacity: 1,
                lineCap: 'round',
                lineJoin: 'round'
              }}
            />
          </>
        )}

        {/* Section selection highlight */}
        {sectionTrack && (
          <Polyline
            positions={sectionTrack}
            pathOptions={{
              color: '#f59e0b',
              weight: 6,
              opacity: 0.9
            }}
          />
        )}

        {/* Start point marker */}
        {startPoint && (
          <CircleMarker
            center={[startPoint.lat, startPoint.lng]}
            radius={8}
            pathOptions={{ color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1 }}
          />
        )}

        {/* End point marker */}
        {endPoint && (
          <CircleMarker
            center={[endPoint.lat, endPoint.lng]}
            radius={8}
            pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 1 }}
          />
        )}

        {/* Map click handler for section selection */}
        {isSelectingSection && rideData?.trackPoints && (
          <MapClickHandler
            trackPoints={rideData.trackPoints}
            startPoint={startPoint}
            onSelectStart={setStartPoint}
            onSelectEnd={setEndPoint}
          />
        )}

        {/* Rated sections */}
        {showSections && sections && sections.map(section => (
          <SectionOverlay
            key={section.id}
            section={section}
            isSelected={selectedSection?.id === section.id}
            onClick={() => setSelectedSection(section)}
          />
        ))}
      </MapContainer>

      {/* Add Section button */}
      {selectedRide && !isSelectingSection && (
        <button
          onClick={handleStartSelection}
          className="absolute top-4 right-4 z-[1000] bg-white hover:bg-gray-50 shadow-lg px-4 py-2 rounded-lg font-medium text-gray-800"
        >
          + Rate Section
        </button>
      )}

      {/* Section selection instruction */}
      {isSelectingSection && !startPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg">
          Click on the track to select START point
          <button onClick={handleCancelSelection} className="ml-3 underline">Cancel</button>
        </div>
      )}

      {isSelectingSection && startPoint && !endPoint && (
        <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg">
          Click on the track to select END point
          <button onClick={handleCancelSelection} className="ml-3 underline">Cancel</button>
        </div>
      )}

      {/* Section rating panel */}
      {startPoint && endPoint && rideData && sectionTrack && (
        <SectionRatingPanel
          rideId={rideData.id}
          biketype={rideData.bike_type}
          startPoint={startPoint}
          endPoint={endPoint}
          trackSegment={sectionTrack}
          onCancel={handleCancelSelection}
          onSave={handleSaveSection}
        />
      )}

      {/* Section details panel */}
      {selectedSection && !isSelectingSection && (
        <SectionDetailsPanel
          section={selectedSection}
          onClose={() => setSelectedSection(null)}
        />
      )}

      {/* Clear preview button - shown when a ride is selected */}
      {selectedRide && !isSelectingSection && (
        <button
          onClick={() => onSelectRide(null)}
          className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-[1000] bg-white hover:bg-gray-50 shadow-lg px-4 py-2 rounded-lg font-medium text-gray-700 flex items-center gap-2 border border-gray-200"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
          Clear preview
        </button>
      )}
    </>
  );
}

function MapClickHandler({ trackPoints, startPoint, onSelectStart, onSelectEnd }) {
  useMapEvents({
    click(e) {
      const closest = findClosestPoint(e.latlng.lat, e.latlng.lng, trackPoints);

      // Check if click is close enough to the track (roughly 100m threshold)
      const threshold = 0.001; // ~100m
      const clickDist = Math.sqrt(
        Math.pow(closest.lat - e.latlng.lat, 2) +
        Math.pow(closest.lng - e.latlng.lng, 2)
      );

      if (clickDist > threshold) {
        return; // Click too far from track
      }

      if (!startPoint) {
        onSelectStart(closest);
      } else {
        onSelectEnd(closest);
      }
    }
  });

  return null;
}

// General map click handler for heatmap/track info popup
function GeneralMapClickHandler({ onMapClick }) {
  useMapEvents({
    click(e) {
      onMapClick(e);
    }
  });

  return null;
}

function SectionOverlay({ section, isSelected, onClick }) {
  // Use the stored track segment if available, otherwise fall back to straight line
  const positions = section.track_segment || [
    [section.start_lat, section.start_lng],
    [section.end_lat, section.end_lng]
  ];

  return (
    <Polyline
      positions={positions}
      pane="sectionsPane"
      pathOptions={{
        color: RATING_COLORS[section.rating] || '#888',
        weight: isSelected ? 8 : 6,
        opacity: isSelected ? 1 : 0.8
      }}
      eventHandlers={{
        click: (e) => {
          e.originalEvent.stopPropagation();
          onClick();
        }
      }}
    />
  );
}

function TrackInfoContent({ tracks, selectedRide, onPreviewRide }) {
  const formatDate = (dateStr) => {
    if (!dateStr) return 'Unknown date';
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  };

  // Get first and last ride dates
  const sortedByDate = [...tracks].sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date) - new Date(b.date);
  });

  const firstRide = sortedByDate[0];
  const lastRide = sortedByDate[sortedByDate.length - 1];

  return (
    <div className="min-w-[200px] max-w-[280px]">
      <div className="font-semibold text-gray-800 mb-2 pb-2 border-b">
        {tracks.length} ride{tracks.length !== 1 ? 's' : ''} at this location
      </div>

      {tracks.length > 1 && (
        <div className="text-xs text-gray-500 mb-2 pb-2 border-b">
          <div>First: {formatDate(firstRide?.date)}</div>
          <div>Last: {formatDate(lastRide?.date)}</div>
        </div>
      )}

      <div className="max-h-[200px] overflow-y-auto space-y-2">
        {tracks.map((track) => (
          <div key={track.id} className="text-sm group">
            <div className="flex items-start justify-between gap-2">
              <span className="font-medium text-gray-700 truncate flex-1">
                {track.title}
              </span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onPreviewRide(track.id)}
                  className="text-gray-400 hover:text-blue-500 p-0.5 transition-colors"
                  title="Preview this ride"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                  </svg>
                </button>
                <span
                  className={`text-xs px-1.5 py-0.5 rounded text-white flex-shrink-0 ${
                    track.bike_type === 'road' ? 'bg-blue-500' :
                    track.bike_type === 'gravel' ? 'bg-amber-600' :
                    'bg-green-600'
                  }`}
                >
                  {BIKE_TYPE_LABELS[track.bike_type] || track.bike_type}
                </span>
              </div>
            </div>
            <div className="text-xs text-gray-500">
              {formatDate(track.date)}
              {track.distance_km && ` · ${track.distance_km.toFixed(1)} km`}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
