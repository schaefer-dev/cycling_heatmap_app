import { useQuery } from '@tanstack/react-query';
import type L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import type { Selection, ViewSettings } from '../../App';
import {
  errorMessage,
  getAllTracks,
  getDeviation,
  getHeatmapData,
  getMapBounds,
  getRide,
  getRidesNearPoint,
  getRoute,
  getRouteTracks,
  getSections,
  type BikeFilter,
  type LatLngTuple,
  type Ride,
} from '../../api';
import { BIKE_TYPES, type BikeType } from '../../domain';
import { formatKm } from '../../format';
import { qk } from '../../queryKeys';
import SectionDetailsPanel from '../SectionDetailsPanel';
import SectionRatingPanel from '../SectionRatingPanel';
import { useToast } from '../Toast';
import HeatmapLayer from './HeatmapLayer';
import {
  AllTracksLayer,
  DeviationLayer,
  MapPanes,
  RouteLayer,
  SectionsLayer,
  SelectedRideLayer,
} from './layers';
import { closestPointIndex, lineBounds } from './mapUtils';
import TrackInfoPopup from './TrackInfoPopup';

interface Props {
  selection: Selection;
  bikeFilter: BikeFilter;
  view: ViewSettings;
  onSelectRide(rideId: string | null, routeId?: string | null): void;
  onClearSelection(): void;
}

interface RidesPopup {
  position: LatLngTuple;
  rides: Ride[];
}

interface SectionPick {
  index: number;
  lat: number;
  lng: number;
}

const DEFAULT_CENTER: LatLngTuple = [49.23, 7.03];
const SECTION_CLICK_TOLERANCE_M = 100;

export default function MapView({
  selection,
  bikeFilter,
  view,
  onSelectRide,
  onClearSelection,
}: Props) {
  const toast = useToast();
  const [map, setMap] = useState<L.Map | null>(null);
  const [popup, setPopup] = useState<RidesPopup | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  /** Section rating in progress; belongs to one ride and ends when another ride is selected. */
  const [pick, setPick] = useState<{
    rideId: string;
    start: SectionPick | null;
    end: SectionPick | null;
  } | null>(null);
  /** View + popup to return to after previewing a ride from the "rides here" popup. */
  const saved = useRef<{ center: L.LatLng; zoom: number; popup: RidesPopup | null } | null>(null);

  const sectionBike = BIKE_TYPES.includes(bikeFilter as BikeType)
    ? (bikeFilter as BikeType)
    : undefined;
  const { data: bounds } = useQuery({
    queryKey: qk.bounds(bikeFilter),
    queryFn: () => getMapBounds(bikeFilter),
  });
  const { data: heat } = useQuery({
    queryKey: qk.heatmap(bikeFilter),
    queryFn: () => getHeatmapData(bikeFilter),
    enabled: view.showHeatmap,
  });
  const { data: allTracks } = useQuery({
    queryKey: qk.allTracks(bikeFilter),
    queryFn: () => getAllTracks(bikeFilter),
    enabled: view.showAllTracks,
  });
  const { data: sections } = useQuery({
    queryKey: qk.sections(bikeFilter),
    queryFn: () => getSections(sectionBike ? { bike_type: sectionBike } : {}),
    enabled: view.showSections,
  });
  const { data: ride } = useQuery({
    queryKey: qk.ride(selection.rideId),
    queryFn: () => getRide(selection.rideId!),
    enabled: !!selection.rideId,
  });
  const { data: route } = useQuery({
    queryKey: qk.route(selection.routeId),
    queryFn: () => getRoute(selection.routeId!),
    enabled: !!selection.routeId,
  });
  const { data: routeTracks } = useQuery({
    queryKey: qk.routeTracks(selection.routeId),
    queryFn: () => getRouteTracks(selection.routeId!),
    enabled: !!selection.routeId,
  });
  const showDeviation =
    !!selection.routeId &&
    !!ride &&
    ride.route_id === selection.routeId &&
    route?.reference_ride_id !== ride.id;
  const { data: deviation } = useQuery({
    queryKey: qk.deviation(selection.rideId),
    queryFn: () => getDeviation(selection.rideId!),
    enabled: showDeviation,
  });

  const rideTrack = ride && ride.id === selection.rideId ? ride.track : null;
  const referenceTrack = route?.reference_track ?? null;
  const selectedSection = sections?.find((s) => s.id === selectedSectionId) ?? null;

  const activePick = pick && pick.rideId === selection.rideId ? pick : null;
  const picking = activePick !== null;
  const start = activePick?.start ?? null;
  const end = activePick?.end ?? null;
  const resetPicking = useCallback(() => setPick(null), []);

  const fit = useMemo(() => {
    if (selection.rideId)
      return { key: `ride:${selection.rideId}`, bounds: rideTrack ? lineBounds(rideTrack) : null };
    if (selection.routeId) {
      return {
        key: `route:${selection.routeId}`,
        bounds: referenceTrack ? lineBounds(referenceTrack) : null,
      };
    }
    return {
      key: `all:${bikeFilter ?? ''}`,
      bounds: bounds ? ([bounds.southwest, bounds.northeast] as [LatLngTuple, LatLngTuple]) : null,
    };
  }, [selection.rideId, selection.routeId, rideTrack, referenceTrack, bikeFilter, bounds]);

  const onMapClick = useCallback(
    async (latlng: L.LatLng) => {
      if (picking) {
        if (!rideTrack) return;
        const idx = closestPointIndex(
          rideTrack,
          [latlng.lat, latlng.lng],
          SECTION_CLICK_TOLERANCE_M
        );
        if (idx < 0) return;
        const [lat, lng] = rideTrack[idx]!;
        const point = { index: idx, lat, lng };
        setPick((p) => p && (p.start ? { ...p, end: point } : { ...p, start: point }));
        return;
      }
      try {
        const rides = await getRidesNearPoint(latlng.lat, latlng.lng, bikeFilter);
        setPopup(rides.length > 0 ? { position: [latlng.lat, latlng.lng], rides } : null);
      } catch (e) {
        toast.show(errorMessage(e), 'error');
      }
    },
    [picking, rideTrack, bikeFilter, toast]
  );

  const previewRide = (r: Ride) => {
    if (map) saved.current = { center: map.getCenter(), zoom: map.getZoom(), popup };
    setPopup(null);
    onSelectRide(r.id, r.route_id);
  };

  const clearSelection = () => {
    onClearSelection();
    resetPicking();
    const s = saved.current;
    saved.current = null;
    if (s && map) {
      map.setView(s.center, s.zoom);
      setPopup(s.popup);
    }
  };

  const sectionTrack = useMemo(() => {
    if (!start || !end || !rideTrack) return null;
    return rideTrack.slice(Math.min(start.index, end.index), Math.max(start.index, end.index) + 1);
  }, [start, end, rideTrack]);

  return (
    <>
      <style>{`.leaflet-tile-pane { filter: grayscale(${100 - view.mapSaturation}%); }`}</style>
      <MapContainer
        center={bounds?.center ?? DEFAULT_CENTER}
        zoom={12}
        className="h-full w-full"
        ref={setMap}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <AutoFit fitKey={fit.key} bounds={fit.bounds} />
        <ClickHandler onClick={onMapClick} />
        <MapPanes>
          {view.showHeatmap && heat && (
            <HeatmapLayer
              points={heat}
              intensity={view.heatmapIntensity}
              opacity={view.heatmapOpacity}
            />
          )}
          {view.showAllTracks && allTracks && (
            <AllTracksLayer tracks={allTracks} opacity={view.trackOpacity} />
          )}
          {selection.routeId && routeTracks && (
            <RouteLayer rides={routeTracks} reference={referenceTrack} dimmed={!!rideTrack} />
          )}
          {rideTrack && <SelectedRideLayer track={rideTrack} />}
          {showDeviation && deviation && <DeviationLayer deviation={deviation} />}
          {view.showSections && sections && (
            <SectionsLayer
              sections={sections}
              selectedId={selectedSectionId}
              onSelect={(s) => setSelectedSectionId(s.id)}
            />
          )}
          {sectionTrack && <SelectedRideLayer track={sectionTrack} />}
        </MapPanes>
        {start && (
          <CircleMarker
            center={[start.lat, start.lng]}
            radius={8}
            pathOptions={{ color: '#16a34a', fillColor: '#22c55e', fillOpacity: 1 }}
          />
        )}
        {end && (
          <CircleMarker
            center={[end.lat, end.lng]}
            radius={8}
            pathOptions={{ color: '#dc2626', fillColor: '#ef4444', fillOpacity: 1 }}
          />
        )}
        {popup && (
          <Popup position={popup.position} eventHandlers={{ remove: () => setPopup(null) }}>
            <TrackInfoPopup rides={popup.rides} onPreview={previewRide} />
          </Popup>
        )}
      </MapContainer>

      {picking && !end && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-blue-500 text-white px-4 py-2 rounded-lg shadow-lg text-sm">
          Click on the blue track to select the {start ? 'END' : 'START'} point
          <button onClick={resetPicking} className="ml-3 underline">
            Cancel
          </button>
        </div>
      )}

      {(selection.rideId || selection.routeId) && !picking && (
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-[1000] flex gap-2">
          {rideTrack && (
            <button
              onClick={() => setPick({ rideId: selection.rideId!, start: null, end: null })}
              className="bg-white hover:bg-gray-50 shadow-lg px-4 py-2 rounded-lg text-sm font-medium text-gray-800 border"
            >
              + Rate section
            </button>
          )}
          <button
            onClick={clearSelection}
            className="bg-white hover:bg-gray-50 shadow-lg px-4 py-2 rounded-lg text-sm font-medium text-gray-700 border"
          >
            × Clear selection
          </button>
        </div>
      )}

      {selection.routeId && route && (
        <RouteLegend
          name={route.name}
          rideCount={route.ride_count}
          deviation={showDeviation ? deviation : undefined}
        />
      )}

      {start && end && ride && sectionTrack && (
        <SectionRatingPanel
          rideId={ride.id}
          bikeType={ride.bike_type}
          startPoint={start}
          endPoint={end}
          trackSegment={sectionTrack}
          onCancel={resetPicking}
          onSave={resetPicking}
        />
      )}

      {selectedSection && !picking && (
        <SectionDetailsPanel
          key={selectedSection.id}
          section={selectedSection}
          onClose={() => setSelectedSectionId(null)}
        />
      )}
    </>
  );
}

/** Fits the map once per `fitKey` when its bounds are known. Returning to the overview doesn't refit. */
function AutoFit({
  fitKey,
  bounds,
}: {
  fitKey: string;
  bounds: [LatLngTuple, LatLngTuple] | null;
}) {
  const map = useMap();
  const lastKey = useRef<string | null>(null);
  const lastOverviewKey = useRef<string | null>(null);
  useEffect(() => {
    if (!bounds || lastKey.current === fitKey) return;
    lastKey.current = fitKey;
    if (fitKey.startsWith('all:')) {
      if (lastOverviewKey.current === fitKey) return;
      lastOverviewKey.current = fitKey;
    }
    map.fitBounds(bounds, { padding: [40, 40] });
  }, [map, fitKey, bounds]);
  return null;
}

function ClickHandler({ onClick }: { onClick(latlng: L.LatLng): void }) {
  useMapEvents({ click: (e) => onClick(e.latlng) });
  return null;
}

function RouteLegend({
  name,
  rideCount,
  deviation,
}: {
  name: string | null;
  rideCount: number;
  deviation?: { detourLengthM: number; skippedLengthM: number };
}) {
  return (
    <div className="absolute bottom-6 left-4 z-[1000] bg-white/95 rounded-lg shadow-lg px-3 py-2 text-xs space-y-1 max-w-xs">
      <div className="font-semibold text-gray-800 truncate">{name ?? 'Route'}</div>
      <LegendLine color="#5b21b6" label="Route reference" />
      {rideCount > 1 && <LegendLine color="#7c3aed" label={`All ${rideCount} rides`} faint />}
      {deviation && (
        <>
          <LegendLine color="#2563eb" label="Selected ride" />
          <LegendLine
            color="#f97316"
            label={`Detour · ${formatKm(deviation.detourLengthM / 1000)}`}
          />
          <LegendLine
            color="#dc2626"
            dashed
            label={`Skipped · ${formatKm(deviation.skippedLengthM / 1000)}`}
          />
        </>
      )}
    </div>
  );
}

function LegendLine({
  color,
  label,
  dashed,
  faint,
}: {
  color: string;
  label: string;
  dashed?: boolean;
  faint?: boolean;
}) {
  return (
    <div className="flex items-center gap-2 text-gray-600">
      <span
        className="inline-block w-6 h-0 border-t-4"
        style={{
          borderColor: color,
          borderTopStyle: dashed ? 'dashed' : 'solid',
          opacity: faint ? 0.5 : 1,
        }}
      />
      {label}
    </div>
  );
}
