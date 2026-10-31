import { X } from 'lucide-react';
import type { BaseMap } from '../App';
import type { BikeFilter } from '../api';
import { BASE_MAPS } from '../components/map/basemaps';
import { BikeDot } from '../components/ui/badges';
import { cx } from '../components/ui/cx';
import { BIKE, BIKE_TYPES } from '../domain';
import { Chip } from './lists';
import type { MobileView } from './view';

/** Map style, overlays and the bike filter, opened from the top-left map button. */
export function LayersPanel({
  view,
  onViewChange,
  bikeFilter,
  onBikeFilterChange,
  onClose,
  top,
}: {
  view: MobileView;
  onViewChange(patch: Partial<MobileView>): void;
  bikeFilter: BikeFilter;
  onBikeFilterChange(filter: BikeFilter): void;
  onClose(): void;
  top: number;
}) {
  return (
    <>
      <button
        type="button"
        aria-label="Close map settings"
        onClick={onClose}
        className="fixed inset-0 z-[1100] cursor-default bg-canvas/40"
      />
      <div
        role="dialog"
        aria-label="Map settings"
        className="animate-pop-in fixed right-3 left-3 z-[1101] origin-top-left rounded-lg border border-line bg-panel p-4 shadow-float"
        style={{ top }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Map</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close map settings"
            className="-mr-2 inline-flex size-10 items-center justify-center rounded-md text-muted active:bg-raised"
          >
            <X aria-hidden className="size-5" />
          </button>
        </div>

        <div role="radiogroup" aria-label="Base map" className="mt-2 grid grid-cols-3 gap-2">
          {(Object.keys(BASE_MAPS) as BaseMap[]).map((key) => (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={view.baseMap === key}
              onClick={() => onViewChange({ baseMap: key })}
              className={cx(
                'h-11 rounded-md border text-sm font-medium',
                view.baseMap === key
                  ? 'border-signal/70 bg-active text-fg'
                  : 'border-line text-muted'
              )}
            >
              {BASE_MAPS[key].label}
            </button>
          ))}
        </div>

        <div className="mt-3 divide-y divide-line border-y border-line">
          <Toggle
            label="Heatmap"
            checked={view.showHeatmap}
            onChange={(v) => onViewChange({ showHeatmap: v })}
          />
          <Toggle
            label="All tracks"
            checked={view.showAllTracks}
            onChange={(v) => onViewChange({ showAllTracks: v })}
          />
        </div>

        <h3 className="mt-4 text-sm text-muted">Bikes</h3>
        <div role="group" aria-label="Filter by bike type" className="mt-2 flex flex-wrap gap-2">
          <Chip pressed={bikeFilter === null} onClick={() => onBikeFilterChange(null)}>
            All bikes
          </Chip>
          {BIKE_TYPES.map((t) => (
            <Chip key={t} pressed={bikeFilter === t} onClick={() => onBikeFilterChange(t)}>
              <BikeDot type={t} />
              {BIKE[t].label}
            </Chip>
          ))}
        </div>
      </div>
    </>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(v: boolean): void;
}) {
  return (
    <label className="flex h-12 items-center justify-between text-base">
      {label}
      <input
        type="checkbox"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden
        className="relative h-7 w-12 shrink-0 rounded-full bg-line-strong transition-colors peer-checked:bg-signal peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal after:absolute after:top-0.5 after:left-0.5 after:size-6 after:rounded-full after:bg-fg after:transition-transform peer-checked:after:translate-x-5 peer-checked:after:bg-panel"
      />
    </label>
  );
}
