import type L from 'leaflet';
import { Layers, Maximize2, Minus, Plus } from 'lucide-react';
import type { BaseMap, ViewSettings } from '../../App';
import type { LatLngTuple } from '../../api';
import { cx } from '../ui/cx';
import { Slider, Switch } from '../ui/fields';
import { Popover } from '../ui/Popover';
import { BASE_MAPS, sampleTileUrl } from './basemaps';

const pct = (v: number) => `${Math.round(v * 100)}%`;

/** Zoom in / out and "show all rides", top left. */
export function ZoomControls({
  map,
  bounds,
}: {
  map: L.Map | null;
  bounds: [LatLngTuple, LatLngTuple] | null;
}) {
  const btn =
    'flex size-8 items-center justify-center text-fg transition-colors hover:bg-active disabled:text-faint disabled:hover:bg-transparent';
  return (
    <div className="absolute top-3 left-3 z-[1000] flex flex-col gap-2">
      <div className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-panel shadow-float">
        <button className={btn} aria-label="Zoom in" title="Zoom in" onClick={() => map?.zoomIn()}>
          <Plus className="size-4" />
        </button>
        <button
          className={btn}
          aria-label="Zoom out"
          title="Zoom out"
          onClick={() => map?.zoomOut()}
        >
          <Minus className="size-4" />
        </button>
      </div>
      <div className="overflow-hidden rounded-md border border-line bg-panel shadow-float">
        <button
          className={btn}
          aria-label="Show all rides"
          title="Show all rides"
          disabled={!bounds}
          onClick={() => bounds && map?.fitBounds(bounds, { padding: [40, 40] })}
        >
          <Maximize2 className="size-4" />
        </button>
      </div>
    </div>
  );
}

/** "Map" button, top right: base map style, overlays and their fine tuning. */
export function MapStyleControl({
  view,
  onChange,
  sectionCount,
  center,
}: {
  view: ViewSettings;
  onChange(patch: Partial<ViewSettings>): void;
  sectionCount: number | undefined;
  center: LatLngTuple | null;
}) {
  return (
    <div className="absolute top-3 right-3 z-[1000]">
      <Popover
        label="Map style and layers"
        align="end"
        className="w-72 p-4"
        trigger={(p) => (
          <button
            {...p}
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-panel px-3 text-sm font-medium text-fg shadow-float transition-colors hover:bg-active aria-expanded:bg-active"
          >
            <Layers aria-hidden className="size-4 text-muted" />
            Map
          </button>
        )}
      >
        <div className="space-y-4">
          <fieldset>
            <legend className="mb-2 text-xs font-medium text-muted">Map style</legend>
            <div className="grid grid-cols-3 gap-2">
              {(Object.keys(BASE_MAPS) as BaseMap[]).map((key) => {
                const style = BASE_MAPS[key];
                const selected = view.baseMap === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected}
                    data-autofocus={selected || undefined}
                    onClick={() => onChange({ baseMap: key })}
                    className="group text-left"
                  >
                    <span
                      className={cx(
                        'block aspect-square overflow-hidden rounded-md border-2 bg-raised transition-colors',
                        selected ? 'border-signal' : 'border-line group-hover:border-line-strong'
                      )}
                    >
                      {center && (
                        <img
                          src={sampleTileUrl(style, center)}
                          alt=""
                          loading="lazy"
                          className="size-full object-cover"
                        />
                      )}
                    </span>
                    <span
                      className={cx(
                        'mt-1 block text-xs',
                        selected ? 'font-medium text-fg' : 'text-muted'
                      )}
                    >
                      {style.label}
                    </span>
                  </button>
                );
              })}
            </div>
            <div className="mt-3">
              <Slider
                label="Map colour"
                min={0}
                max={100}
                step={5}
                value={view.mapSaturation}
                format={(v) => `${v}%`}
                onChange={(v) => onChange({ mapSaturation: v })}
              />
            </div>
          </fieldset>

          <fieldset className="space-y-3 border-t border-line pt-4">
            <legend className="sr-only">Layers</legend>
            <div className="space-y-2">
              <Switch
                label="Heatmap"
                checked={view.showHeatmap}
                onChange={(v) => onChange({ showHeatmap: v })}
              />
              {view.showHeatmap && (
                <div className="space-y-1.5 pl-9.5">
                  <Slider
                    label="Intensity"
                    min={10}
                    max={100}
                    step={5}
                    value={view.heatmapIntensity}
                    format={(v) => `${v}%`}
                    onChange={(v) => onChange({ heatmapIntensity: v })}
                  />
                  <Slider
                    label="Opacity"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={view.heatmapOpacity}
                    format={pct}
                    onChange={(v) => onChange({ heatmapOpacity: v })}
                  />
                </div>
              )}
            </div>
            <div className="space-y-2">
              <Switch
                label="All tracks"
                hint={<span className="text-2xs text-faint">by bike type</span>}
                checked={view.showAllTracks}
                onChange={(v) => onChange({ showAllTracks: v })}
              />
              {view.showAllTracks && (
                <div className="pl-9.5">
                  <Slider
                    label="Opacity"
                    min={0.1}
                    max={1}
                    step={0.05}
                    value={view.trackOpacity}
                    format={pct}
                    onChange={(v) => onChange({ trackOpacity: v })}
                  />
                </div>
              )}
            </div>
            <Switch
              label="Rated sections"
              hint={
                sectionCount !== undefined && (
                  <span className="tnum text-2xs text-faint">{sectionCount}</span>
                )
              }
              checked={view.showSections}
              onChange={(v) => onChange({ showSections: v })}
            />
          </fieldset>
        </div>
      </Popover>
    </div>
  );
}
