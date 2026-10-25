import { describe, expect, it } from 'vitest';
import type { FilePreview, RouteSummary } from '../src/api';
import { summarizePreview } from '../src/components/importSummary';
import { sortRoutes } from '../src/components/sidebar/routeSort';
import {
  formatDate,
  formatDuration,
  formatKm,
  formatRelative,
  formatSpeed,
  formatTime,
} from '../src/format';

describe('format', () => {
  it('formats calendar dates without timezone shifts', () => {
    expect(formatDate('2025-06-14')).toBe('14 Jun 2025');
    expect(formatDate('2025-06-14', { weekday: true })).toBe('Sat, 14 Jun 2025');
    expect(formatDate(null)).toBe('Unknown date');
    expect(formatDate('garbage')).toBe('Unknown date');
  });

  it('formats start times only for full timestamps', () => {
    expect(formatTime('2025-06-14')).toBe('');
    expect(formatTime(null)).toBe('');
    expect(formatTime('2025-06-14T05:42:00.000Z')).toMatch(/^\d{2}:\d{2}$/);
  });

  it('formats durations, distances and speeds', () => {
    expect(formatDuration(45 * 60)).toBe('45 min');
    expect(formatDuration(3 * 3600 + 7 * 60)).toBe('3:07 h');
    expect(formatDuration(null)).toBe('');
    expect(formatKm(73.456)).toBe('73.5 km');
    expect(formatKm(null)).toBe('–');
    expect(formatSpeed(50, 7200)).toBe('25.0 km/h');
    expect(formatSpeed(50, 0)).toBe('');
  });

  it('describes how long ago something happened', () => {
    const now = new Date('2025-06-14T18:00:00');
    expect(formatRelative('2025-06-14', now)).toBe('today');
    expect(formatRelative('2025-06-13', now)).toBe('yesterday');
    expect(formatRelative('2025-06-04', now)).toBe('10 days ago');
    expect(formatRelative('2025-05-01', now)).toBe('6 weeks ago');
    expect(formatRelative('2024-12-14', now)).toBe('6 months ago');
    expect(formatRelative('2023-06-14', now)).toBe('2 years ago');
  });
});

const route = (over: Partial<RouteSummary>): RouteSummary => ({
  id: 'x',
  name: 'x',
  name_source: 'geo',
  reference_ride_id: null,
  ride_count: 1,
  first_ridden: null,
  last_ridden: null,
  avg_distance_km: null,
  avg_elevation_gain_m: null,
  bike_types: null,
  length_m: null,
  planned_route_name: null,
  ...over,
});

describe('sortRoutes', () => {
  const routes = [
    route({ id: 'a', name: 'Beta', ride_count: 2, last_ridden: '2025-01-01', avg_distance_km: 50 }),
    route({
      id: 'b',
      name: 'Alpha',
      ride_count: 9,
      last_ridden: '2024-01-01',
      avg_distance_km: 90,
    }),
    route({
      id: 'c',
      name: 'Gamma',
      ride_count: 2,
      last_ridden: '2025-06-01',
      avg_distance_km: 20,
    }),
  ];
  const ids = (key: Parameters<typeof sortRoutes>[1]) => sortRoutes(routes, key).map((r) => r.id);

  it('sorts by last ridden, count (ties: recent first), distance and name', () => {
    expect(ids('last')).toEqual(['c', 'a', 'b']);
    expect(ids('count')).toEqual(['b', 'c', 'a']);
    expect(ids('distance')).toEqual(['b', 'a', 'c']);
    expect(ids('name')).toEqual(['b', 'a', 'c']);
  });
});

describe('summarizePreview', () => {
  const p = (over: Partial<FilePreview>): FilePreview => ({
    filename: 'f.gpx',
    title: null,
    date: null,
    distance_km: 1,
    activityType: 'cycling',
    isCycling: true,
    detectedBikeType: null,
    isDuplicate: false,
    duplicateOf: null,
    pointCount: 10,
    ...over,
  });

  it('counts cycling, non-cycling, unknown and duplicates', () => {
    expect(
      summarizePreview([
        p({}),
        p({ isDuplicate: true }),
        p({ isCycling: false, activityType: 'running' }),
        p({ isCycling: false, activityType: 'unknown' }),
      ])
    ).toEqual({
      cycling: 2,
      nonCycling: 1,
      unknown: 1,
      duplicates: 1,
      nonCyclingTypes: ['running'],
    });
  });
});
