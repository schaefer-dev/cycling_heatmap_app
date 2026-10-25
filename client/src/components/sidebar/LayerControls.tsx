import { useState } from 'react';
import type { ViewSettings } from '../../App';

interface Props {
  view: ViewSettings;
  onChange(patch: Partial<ViewSettings>): void;
}

export default function LayerControls({ view, onChange }: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="text-sm">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Toggle
          label="Heatmap"
          checked={view.showHeatmap}
          onChange={(v) => onChange({ showHeatmap: v })}
        />
        <Toggle
          label="All tracks"
          checked={view.showAllTracks}
          onChange={(v) => onChange({ showAllTracks: v })}
        />
        <Toggle
          label="Sections"
          checked={view.showSections}
          onChange={(v) => onChange({ showSections: v })}
        />
        <button
          onClick={() => setOpen((o) => !o)}
          className="ml-auto text-xs text-gray-500 hover:text-gray-700"
        >
          {open ? 'Hide settings' : 'Settings'}
        </button>
      </div>
      {open && (
        <div className="mt-2 space-y-1 pl-1">
          <Slider
            label="Heat intensity"
            min={10}
            max={100}
            step={5}
            value={view.heatmapIntensity}
            format={(v) => `${v}%`}
            onChange={(v) => onChange({ heatmapIntensity: v })}
          />
          <Slider
            label="Heat opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={view.heatmapOpacity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onChange({ heatmapOpacity: v })}
          />
          <Slider
            label="Track opacity"
            min={0.1}
            max={1}
            step={0.05}
            value={view.trackOpacity}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onChange({ trackOpacity: v })}
          />
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
      )}
    </div>
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
    <label className="flex items-center gap-1.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="rounded"
      />
      {label}
    </label>
  );
}

function Slider(props: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format(v: number): string;
  onChange(v: number): void;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-24">{props.label}</span>
      <input
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
        className="flex-1 h-1.5 accent-blue-500"
      />
      <span className="text-xs text-gray-500 w-10 text-right">{props.format(props.value)}</span>
    </label>
  );
}
