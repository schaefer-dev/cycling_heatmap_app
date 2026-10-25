import { useQuery } from '@tanstack/react-query';
import type L from 'leaflet';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MousePointerClick, X } from 'lucide-react';
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
  getStats,
  type BikeFilter,
  type LatLngTuple,
  type Ride,
} from '../../api';
import { BIKE_TYPES, type BikeType } from '../../domain';
import { qk } from '../../queryKeys';
import SectionDetailsPanel from '../SectionDetailsPanel';
import SectionRatingPanel from '../SectionRatingPanel';
import { useToast } from '../Toast';
import { Button } from '../ui/Button';
import { BASE_MAPS } from './basemaps';
import { POINT_COLORS } from './colors';
import HeatmapLayer from './HeatmapLayer';
import {
  AllTracksLayer,
  DeviationLayer,
  MapPanes,
  RouteLayer,
  SectionsLayer,
  SelectedRideLayer,
} from './layers';
import { Legends } from './Legends';
import { MapStyleControl, ZoomControls } from './MapControls';
import { closestPointIndex, lineBounds } from './mapUtils';
import { PANES } from './panes';
import RideDetailPanel from './RideDetailPanel';
import TrackInfoPopup from './TrackInfoPopup';

interface Props {
  selection: Selection;
  bikeFilter: BikeFilter;
  view: ViewSettings;
  onViewChange(patch: Partial<ViewSettings>): void;
  onSelectRide(rideId: string | null, routeId?: string | null): void;
  onShowRoute(routeId: string, rideId?: string | null): void;
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
const POINT_STYLE = { color: POINT_COLORS.casing, weight: 2, fillOpacity: 1 };

export default function MapView({
  selection,
  bikeFilter,
  view,
  onViewChange,
  onSelectRide,
  onShowRoute,
  onClearSelection,
}: Props) {
  const toast = useToast();
  const [map, setMap] = useState<L.Map | null>(null);
  const [popup, setPopup] = useState<RidesPopup | null>(null);
  const [selectedSectionId, setSelectedSectionId] = useState<string | null>(null);
  /** Track point under the cursor in the elevation profile (belongs to one ride). */
  const [hoverPoint, setHoverPoint] = useState<{ rideId: string; index: number } | null>(null);
  const baseMap = BASE_MAPS[view.baseMap] ?? BASE_MAPS.dark;
  const tone = baseMap.tone;
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
  const { data: stats } = useQuery({ queryKey: qk.stats(), queryFn: getStats });
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
  const hoverLatLng =
    rideTrack && hoverPoint && hoverPoint.rideId === selection.rideId
      ? (rideTrack[hoverPoint.index] ?? null)
      : null;
  const allBounds: [LatLngTuple, LatLngTuple] | null = bounds
    ? [bounds.southwest, bounds.northeast]
    : null;

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
        zoomControl={false}
        className="h-full w-full"
        ref={setMap}
      >
        <TileLayer
          key={view.baseMap}
          attribution={baseMap.attribution}
          url={baseMap.url}
          maxNativeZoom={baseMap.maxNativeZoom}
          maxZoom={19}
        />
        {baseMap.labelsUrl && (
          <TileLayer
            key={`${view.baseMap}-labels`}
            url={baseMap.labelsUrl}
            maxNativeZoom={baseMap.maxNativeZoom}
            maxZoom={19}
            zIndex={2}
          />
        )}
        <AutoFit fitKey={fit.key} bounds={fit.bounds} />
        <ClickHandler onClick={onMapClick} />
        <MapPanes>
          {view.showHeatmap && heat && (
            <HeatmapLayer
              points={heat}
              intensity={view.heatmapIntensity}
              opacity={view.heatmapOpacity}
              tone={tone}
            />
          )}
          {view.showAllTracks && allTracks && (
            <AllTracksLayer tracks={allTracks} opacity={view.trackOpacity} />
          )}
          {selection.routeId && routeTracks && (
            <RouteLayer
              rides={routeTracks}
              reference={referenceTrack}
              dimmed={!!rideTrack}
              tone={tone}
            />
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
          {start && (
            <CircleMarker
              center={[start.lat, start.lng]}
              radius={8}
              pane={PANES.points.name}
              pathOptions={{ ...POINT_STYLE, fillColor: POINT_COLORS.start }}
            />
          )}
          {end && (
            <CircleMarker
              center={[end.lat, end.lng]}
              radius={8}
              pane={PANES.points.name}
              pathOptions={{ ...POINT_STYLE, fillColor: POINT_COLORS.end }}
            />
          )}
          {hoverLatLng && (
            <CircleMarker
              center={hoverLatLng}
              radius={6}
              interactive={false}
              pane={PANES.points.name}
              pathOptions={{ ...POINT_STYLE, fillColor: POINT_COLORS.cursor }}
            />
          )}
        </MapPanes>
        {popup && (
          <Popup position={popup.position} eventHandlers={{ remove: () => setPopup(null) }}>
            <TrackInfoPopup rides={popup.rides} onPreview={previewRide} />
          </Popup>
        )}
      </MapContainer>

      <ZoomControls map={map} bounds={allBounds} />
      <MapStyleControl
        view={view}
        onChange={onViewChange}
        sectionCount={stats?.sections.total}
        center={bounds?.center ?? null}
      />

      {picking && !end && (
        <div
          role="status"
          className="animate-pop-in absolute top-3 left-1/2 z-[1000] flex -translate-x-1/2 items-center gap-3 rounded-lg border border-line bg-panel py-2 pr-2 pl-3 text-sm shadow-float"
        >
          <MousePointerClick aria-hidden className="size-4 text-signal" />
          <span>
            <span className="text-muted">Step {start ? 2 : 1} of 3 </span>
            Click the highlighted track to set the {start ? 'end' : 'start'} point
          </span>
          <Button size="sm" variant="ghost" onClick={resetPicking}>
            Cancel
          </Button>
        </div>
      )}

      {(selection.rideId || selection.routeId) && !picking && (
        <div className="absolute bottom-6 left-1/2 z-[1000] -translate-x-1/2">
          <button
            onClick={clearSelection}
            className="inline-flex h-9 items-center gap-2 rounded-full border border-line bg-panel px-4 text-sm font-medium text-fg shadow-float transition-colors hover:bg-active"
          >
            <X aria-hidden className="size-4 text-muted" />
            Clear selection
          </button>
        </div>
      )}

      <Legends
        tone={tone}
        showHeat={view.showHeatmap}
        route={
          selection.routeId && route
            ? {
                name: route.name,
                rideCount: route.ride_count,
                deviation: showDeviation ? deviation : undefined,
              }
            : undefined
        }
      />

      {ride && rideTrack && !picking && !selectedSection && (
        <RideDetailPanel
          key={ride.id}
          ride={ride}
          showRouteAction={!!ride.route_id && ride.route_id !== selection.routeId}
          onRateSection={() => setPick({ rideId: ride.id, start: null, end: null })}
          onShowRoute={(routeId) => onShowRoute(routeId, ride.id)}
          onClose={clearSelection}
          onHoverPoint={(index) =>
            setHoverPoint(index === null ? null : { rideId: ride.id, index })
          }
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
