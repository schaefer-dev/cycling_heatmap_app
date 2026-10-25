import L from 'leaflet';
import { useMemo, type ReactNode } from 'react';
import { Pane, Polyline } from 'react-leaflet';
import type { Deviation, LatLngTuple, MapTrack, Section } from '../../api';
import { bikeColor, RATING_BY_VALUE, UNASSIGNED_COLOR } from '../../domain';
import type { MapTone } from './basemaps';
import { LINE_COLORS, ROUTE_COLORS } from './colors';
import { PANES } from './panes';

/** Declares the custom panes; layers using them must be rendered inside. */
export function MapPanes({ children }: { children: ReactNode }) {
  return (
    <>
      {Object.values(PANES).map((p) => (
        <Pane key={p.name} name={p.name} style={{ zIndex: p.zIndex }} />
      ))}
      {children}
    </>
  );
}

/**
 * Every ride as a thin line on one shared canvas (hundreds of SVG paths are slow). Lines are not
 * interactive: a click falls through to the map, which asks the server what is there.
 */
export function AllTracksLayer({ tracks, opacity }: { tracks: MapTrack[]; opacity: number }) {
  const renderer = useMemo(() => L.canvas({ pane: PANES.tracks.name }), []);
  return (
    <>
      {tracks.map((t) => (
        <Polyline
          key={t.id}
          positions={t.track}
          pane={PANES.tracks.name}
          pathOptions={{ color: bikeColor(t.bike_type), weight: 3, opacity }}
          interactive={false}
          renderer={renderer}
        />
      ))}
    </>
  );
}

/** All rides of the selected route, plus its reference line on top. */
export function RouteLayer({
  rides,
  reference,
  dimmed,
  tone,
}: {
  rides: Array<{ id: string; track: LatLngTuple[] }>;
  reference: LatLngTuple[] | null;
  dimmed: boolean;
  tone: MapTone;
}) {
  const colors = ROUTE_COLORS[tone];
  const renderer = useMemo(() => L.canvas({ pane: PANES.route.name }), []);
  return (
    <>
      {rides.map((r) => (
        <Polyline
          key={r.id}
          positions={r.track}
          pane={PANES.route.name}
          pathOptions={{ color: colors.rides, weight: 2, opacity: dimmed ? 0.3 : 0.5 }}
          interactive={false}
          renderer={renderer}
        />
      ))}
      {reference && !dimmed && (
        <Polyline
          positions={reference}
          pane={PANES.route.name}
          pathOptions={{ color: colors.reference, weight: 4, opacity: 0.95 }}
          interactive={false}
          renderer={renderer}
        />
      )}
    </>
  );
}

/** The selected ride: a white line (the logo's road stroke) on a navy casing, readable on any map. */
export function SelectedRideLayer({ track }: { track: LatLngTuple[] }) {
  return (
    <>
      <Polyline
        positions={track}
        pane={PANES.ride.name}
        pathOptions={{
          color: LINE_COLORS.rideCasing,
          weight: 9,
          opacity: 0.9,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        interactive={false}
      />
      <Polyline
        positions={track}
        pane={PANES.ride.name}
        pathOptions={{
          color: LINE_COLORS.ride,
          weight: 4,
          opacity: 1,
          lineCap: 'round',
          lineJoin: 'round',
        }}
        interactive={false}
      />
    </>
  );
}

/** Where the selected ride left its route (orange) and which parts of the route it skipped (red dashes). */
export function DeviationLayer({ deviation }: { deviation: Deviation }) {
  return (
    <>
      {deviation.skipped.map((run, i) => (
        <Polyline
          key={`s${i}`}
          positions={run}
          pane={PANES.deviation.name}
          pathOptions={{ color: LINE_COLORS.skipped, weight: 4, opacity: 0.95, dashArray: '6 8' }}
          interactive={false}
        />
      ))}
      {deviation.detours.map((run, i) => (
        <Polyline
          key={`d${i}`}
          positions={run}
          pane={PANES.deviation.name}
          pathOptions={{ color: LINE_COLORS.detour, weight: 6, opacity: 1, lineCap: 'round' }}
          interactive={false}
        />
      ))}
    </>
  );
}

export function SectionsLayer({
  sections,
  selectedId,
  onSelect,
}: {
  sections: Section[];
  selectedId: string | null;
  onSelect(section: Section): void;
}) {
  return (
    <>
      {sections.map((s) => (
        <Polyline
          key={s.id}
          positions={
            s.track_segment ?? [
              [s.start_lat, s.start_lng],
              [s.end_lat, s.end_lng],
            ]
          }
          pane={PANES.sections.name}
          pathOptions={{
            color: RATING_BY_VALUE[s.rating]?.color ?? UNASSIGNED_COLOR,
            weight: selectedId === s.id ? 8 : 6,
            opacity: selectedId === s.id ? 1 : 0.8,
          }}
          // Keep the click on the section; don't also trigger the map's "rides here" popup.
          bubblingMouseEvents={false}
          eventHandlers={{ click: () => onSelect(s) }}
        />
      ))}
    </>
  );
}
