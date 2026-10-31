import { useQuery } from '@tanstack/react-query';
import type L from 'leaflet';
import { useMemo } from 'react';
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  TileLayer,
  useMapEvents,
} from 'react-leaflet';
import type { Selection } from '../App';
import {
  getAllTracks,
  getDeviation,
  getHeatmapData,
  getMapBounds,
  getRide,
  getRideLine,
  getRoute,
  getRouteTracks,
  type BikeFilter,
  type LatLngTuple,
} from '../api';
import { AutoFit } from '../components/map/AutoFit';
import { BASE_MAPS } from '../components/map/basemaps';
import { POINT_COLORS } from '../components/map/colors';
import HeatmapLayer from '../components/map/HeatmapLayer';
import {
  AllTracksLayer,
  DeviationLayer,
  MapPanes,
  PreviewLayer,
  RouteLayer,
  SelectedRideLayer,
} from '../components/map/layers';
import { lineBounds } from '../components/map/mapUtils';
import { PANES } from '../components/map/panes';
import type { PreviewTarget } from '../preview';
import { qk } from '../queryKeys';
import type { MobileView } from './view';

const DEFAULT_CENTER: LatLngTuple = [49.23, 7.03];
const POINT_STYLE = { color: POINT_COLORS.casing, weight: 2, fillOpacity: 1 };
const EDGE = 28;

/**
 * The phone map: read only. Shows the selected route/ride, or the deck's active card, and fits it
 * into the part of the screen the sheet leaves free. A tap asks for the rides at that spot.
 */
export default function MobileMap({
  selection,
  preview,
  bikeFilter,
  view,
  inset,
  fitNonce,
  tapPoint,
  scrubIndex,
  onTap,
}: {
  selection: Selection;
  preview: PreviewTarget | null;
  bikeFilter: BikeFilter;
  view: MobileView;
  /** Screen area covered by floating controls (top) and the sheet (bottom), in px. */
  inset: { top: number; bottom: number };
  /** Bumped by the "fit" button to refit the current view. */
  fitNonce: number;
  tapPoint: LatLngTuple | null;
  /** Track point under the finger in the elevation profile of the selected ride. */
  scrubIndex: number | null;
  onTap(point: LatLngTuple): void;
}) {
  const baseMap = BASE_MAPS[view.baseMap] ?? BASE_MAPS.dark;
  const tone = baseMap.tone;

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

  const previewRouteId = preview?.kind === 'route' ? preview.id : null;
  const previewRideId = preview?.kind === 'ride' ? preview.id : null;
  const { data: previewRoute } = useQuery({
    queryKey: qk.route(previewRouteId),
    queryFn: () => getRoute(previewRouteId!),
    enabled: !!previewRouteId,
  });
  const { data: previewRideLine } = useQuery({
    queryKey: qk.rideLine(previewRideId),
    queryFn: () => getRideLine(previewRideId!),
    enabled: !!previewRideId,
  });
  const previewTrack = previewRouteId
    ? (previewRoute?.reference_track ?? null)
    : previewRideId
      ? (previewRideLine ?? null)
      : null;

  const rideTrack = ride && ride.id === selection.rideId ? ride.track : null;
  const referenceTrack = route?.reference_track ?? null;
  const scrubLatLng = rideTrack && scrubIndex !== null ? (rideTrack[scrubIndex] ?? null) : null;

  const fit = useMemo(() => {
    if (selection.rideId)
      return { key: `ride:${selection.rideId}`, bounds: rideTrack ? lineBounds(rideTrack) : null };
    if (selection.routeId)
      return {
        key: `route:${selection.routeId}`,
        bounds: referenceTrack ? lineBounds(referenceTrack) : null,
      };
    if (preview)
      return {
        key: `preview:${preview.kind}:${preview.id}`,
        bounds: previewTrack ? lineBounds(previewTrack) : null,
      };
    return {
      key: `all:${bikeFilter ?? ''}`,
      bounds: bounds ? ([bounds.southwest, bounds.northeast] as [LatLngTuple, LatLngTuple]) : null,
    };
  }, [
    selection.rideId,
    selection.routeId,
    rideTrack,
    referenceTrack,
    preview,
    previewTrack,
    bikeFilter,
    bounds,
  ]);

  // Refit when the free area changes (sheet moved) or on request; the overview key keeps its
  // "all:" prefix so AutoFit's overview handling still applies.
  const fitKey = `${fit.key}|${Math.round(inset.bottom)}|${fitNonce}`;
  const fitOptions: L.FitBoundsOptions = {
    paddingTopLeft: [EDGE, inset.top + EDGE],
    paddingBottomRight: [EDGE, inset.bottom + EDGE],
    maxZoom: 16,
  };

  return (
    <MapContainer
      center={bounds?.center ?? DEFAULT_CENTER}
      zoom={12}
      zoomControl={false}
      attributionControl={false}
      className="h-full w-full"
    >
      <TileLayer
        key={view.baseMap}
        attribution={baseMap.attribution}
        url={baseMap.url}
        maxNativeZoom={baseMap.maxNativeZoom}
        maxZoom={19}
        detectRetina={false}
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
      <AttributionControl position="topright" prefix={false} />
      <AutoFit fitKey={fitKey} bounds={fit.bounds} options={fitOptions} />
      <TapHandler onTap={onTap} />
      <MapPanes>
        {view.showHeatmap && heat && (
          <HeatmapLayer points={heat} intensity={50} opacity={0.8} tone={tone} />
        )}
        {view.showAllTracks && allTracks && <AllTracksLayer tracks={allTracks} opacity={0.85} />}
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
        {previewTrack && !selection.routeId && !selection.rideId && (
          <PreviewLayer track={previewTrack} />
        )}
        {tapPoint && (
          <CircleMarker
            center={tapPoint}
            radius={7}
            interactive={false}
            pane={PANES.points.name}
            pathOptions={{ ...POINT_STYLE, fillColor: POINT_COLORS.cursor }}
          />
        )}
        {scrubLatLng && (
          <CircleMarker
            center={scrubLatLng}
            radius={7}
            interactive={false}
            pane={PANES.points.name}
            pathOptions={{ ...POINT_STYLE, fillColor: POINT_COLORS.cursor }}
          />
        )}
      </MapPanes>
    </MapContainer>
  );
}

function TapHandler({ onTap }: { onTap(point: LatLngTuple): void }) {
  useMapEvents({ click: (e) => onTap([e.latlng.lat, e.latlng.lng]) });
  return null;
}
