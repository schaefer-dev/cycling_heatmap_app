import type { MapTone } from './basemaps';

/** Route lines: light violet on dark maps, deep violet on light ones. */
export const ROUTE_COLORS: Record<MapTone, { rides: string; reference: string }> = {
  dark: { rides: '#a78bfa', reference: '#c4b5fd' },
  light: { rides: '#7c3aed', reference: '#5b21b6' },
};

/** Map line colours shared with the legends. */
export const LINE_COLORS = {
  ride: '#f8fafc',
  rideCasing: '#0e1428',
  /** Hovered sidebar row: cyan, set apart from the white selected ride. */
  preview: '#22d3ee',
  detour: '#fb923c',
  skipped: '#f87171',
};

/** Point markers: section start/end and the elevation-profile cursor. */
export const POINT_COLORS = {
  casing: '#0e1428',
  start: '#4ade80',
  end: '#f87171',
  cursor: '#22d3ee',
};
