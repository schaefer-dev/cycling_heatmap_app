import { useEffect, useRef, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap, useMapEvents } from 'react-leaflet';
import { useQuery } from '@tanstack/react-query';
import 'leaflet/dist/leaflet.css';
import { getHeatmapData, getMapBounds, getRide, getSections } from '../api';
import HeatmapLayer from './HeatmapLayer';
import SectionRatingPanel from './SectionRatingPanel';

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

export default function Map({
  selectedRide,
  bikeTypeFilter,
  showHeatmap,
  showSections
}) {
  const mapRef = useRef(null);
  const [isSelectingSection, setIsSelectingSection] = useState(false);
  const [startPoint, setStartPoint] = useState(null);
  const [endPoint, setEndPoint] = useState(null);

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

  // Default center (will be overridden by bounds)
  const defaultCenter = bounds?.center || [49.23, 7.03];
  const defaultZoom = 12;

  return (
    <>
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

        {/* Fit to bounds on load */}
        {bounds && !selectedRide && <FitBounds bounds={bounds} />}

        {/* Fit to selected ride */}
        {selectedRide && rideData?.trackPoints && (
          <FitToRide trackPoints={rideData.trackPoints} />
        )}

        {/* Heatmap layer */}
        {showHeatmap && heatmapData && heatmapData.length > 0 && (
          <HeatmapLayer points={heatmapData} />
        )}

        {/* Selected ride track */}
        {selectedRide && rideTrack && (
          <Polyline
            positions={rideTrack}
            pathOptions={{
              color: '#3b82f6',
              weight: 4,
              opacity: 0.8
            }}
          />
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
          <SectionOverlay key={section.id} section={section} />
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
      {startPoint && endPoint && rideData && (
        <SectionRatingPanel
          rideId={rideData.id}
          biketype={rideData.bike_type}
          startPoint={startPoint}
          endPoint={endPoint}
          onCancel={handleCancelSelection}
          onSave={handleSaveSection}
        />
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

function SectionOverlay({ section }) {
  // For now, we'll draw a line between start and end points
  // In future iterations, this could follow the actual track
  const positions = [
    [section.start_lat, section.start_lng],
    [section.end_lat, section.end_lng]
  ];

  return (
    <Polyline
      positions={positions}
      pathOptions={{
        color: RATING_COLORS[section.rating] || '#888',
        weight: 6,
        opacity: 0.8
      }}
    />
  );
}
