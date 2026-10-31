import axios from 'axios';
import type { BikeType, Rating } from './domain';

const http = axios.create({ baseURL: '/api' });

export type LatLngTuple = [number, number];
export type BikeFilter = BikeType | 'unassigned' | null;

export interface Ride {
  id: string;
  title: string | null;
  date: string | null;
  start_time: string | null;
  bike_type: BikeType | null;
  bike_type_source: 'auto' | 'user' | null;
  distance_km: number | null;
  elevation_gain_m: number | null;
  duration_s: number | null;
  moving_time_s: number | null;
  notes: string | null;
  source: 'gpx' | 'garmin' | 'hammerhead';
  activity_type: string | null;
  garmin_activity_id: number | null;
  hammerhead_activity_id: string | null;
  route_id: string | null;
  route_name?: string | null;
  /** Planned Hammerhead route the user accepted for this ride's route group. */
  planned_route_name?: string | null;
  route_similarity: number | null;
  route_direction: 'forward' | 'reverse' | null;
  route_assignment: 'auto' | 'manual' | null;
  created_at: string;
}

export interface Section {
  id: string;
  ride_id: string;
  ride_title?: string | null;
  ride_date?: string | null;
  start_lat: number;
  start_lng: number;
  start_index: number | null;
  end_lat: number;
  end_lng: number;
  end_index: number | null;
  track_segment: LatLngTuple[] | null;
  rating: Rating;
  bike_type: BikeType;
  surface_tags: string[];
  notes: string | null;
  created_at: string;
}

export interface RideDetail extends Ride {
  track: LatLngTuple[];
  elevation: Array<number | null>;
  devices: Array<Record<string, string | number | null>>;
  sections: Section[];
}

export interface RouteSummary {
  id: string;
  name: string | null;
  name_source: 'title' | 'geo' | 'fallback' | 'user' | null;
  reference_ride_id: string | null;
  ride_count: number;
  first_ridden: string | null;
  last_ridden: string | null;
  avg_distance_km: number | null;
  avg_elevation_gain_m: number | null;
  bike_types: string | null;
  length_m: number | null;
  planned_route_name: string | null;
}

export interface RouteDetail extends RouteSummary {
  reference_track: LatLngTuple[] | null;
  rides: Ride[];
}

export interface Deviation {
  routeId: string | null;
  referenceRideId: string | null;
  detours: LatLngTuple[][];
  skipped: LatLngTuple[][];
  detourLengthM: number;
  skippedLengthM: number;
}

export interface MapTrack {
  id: string;
  title: string | null;
  bike_type: BikeType | null;
  date: string | null;
  distance_km: number | null;
  route_id: string | null;
  track: LatLngTuple[];
}

export interface Bounds {
  southwest: LatLngTuple;
  northeast: LatLngTuple;
  center: LatLngTuple;
}

export interface Stats {
  rides: {
    total: number;
    total_distance_km: number;
    total_elevation_m: number;
    by_type: Record<BikeType | 'unassigned', number>;
  };
  routes: { total: number; repeated: number };
  sections: { total: number; by_rating: Record<Rating, number> };
}

export interface SyncRun {
  id: number;
  started_at: string;
  finished_at: string | null;
  mode: 'incremental' | 'backfill';
  status: 'running' | 'success' | 'error';
  imported: number;
  linked: number;
  skipped: number;
  failed: number;
  error: string | null;
}

export type SyncProvider = 'garmin' | 'hammerhead';

export interface ProviderSyncStatus {
  configured: boolean;
  running: boolean;
  next_run_at: string | null;
  last_run: SyncRun | null;
  last_success_at: string | null;
  recent_runs: SyncRun[];
  activities: Partial<Record<'imported' | 'linked' | 'skipped' | 'failed', number>>;
}

export interface SyncStatus {
  garmin: ProviderSyncStatus;
  hammerhead: ProviderSyncStatus & { connected: boolean; connected_at: string | null };
}

export interface FilePreview {
  filename: string;
  title: string | null;
  date: string | null;
  distance_km: number;
  activityType: string;
  isCycling: boolean;
  detectedBikeType: BikeType | null;
  isDuplicate: boolean;
  duplicateOf: string | null;
  pointCount: number;
}

export interface ImportResult {
  imported: Ride[];
  skipped: Array<{ file: string; reason: string }>;
  errors: Array<{ file: string; error: string }>;
  summary: { total: number; success: number; skipped: number; failed: number };
}

const bikeParams = (bikeType: BikeFilter) => (bikeType ? { bike_type: bikeType } : {});

/** Error text from an API failure, for toasts. */
export function errorMessage(error: unknown): string {
  if (axios.isAxiosError(error))
    return (error.response?.data as { error?: string })?.error ?? error.message;
  return error instanceof Error ? error.message : String(error);
}

// ---- rides ------------------------------------------------------------------------------------

export const getRides = async (bikeType: BikeFilter) =>
  (await http.get<Ride[]>('/rides', { params: bikeParams(bikeType) })).data;

export const getRide = async (id: string) => (await http.get<RideDetail>(`/rides/${id}`)).data;

export const updateRide = async (
  id: string,
  updates: { title?: string; notes?: string | null; bike_type?: BikeType | null }
) => (await http.patch<Ride>(`/rides/${id}`, updates)).data;

export const deleteRide = async (id: string) => (await http.delete(`/rides/${id}`)).data;

export const getRidesNearPoint = async (lat: number, lng: number, bikeType: BikeFilter) =>
  (await http.get<Ride[]>('/rides/near-point', { params: { lat, lng, ...bikeParams(bikeType) } }))
    .data;

/** The ride's simplified display line (light; for hover previews). */
export const getRideLine = async (id: string) =>
  (await http.get<{ track: LatLngTuple[] }>(`/rides/${id}/line`)).data.track;

export const getDeviation = async (rideId: string) =>
  (await http.get<Deviation>(`/rides/${rideId}/deviation`)).data;

export const moveRideToRoute = async (rideId: string, routeId: string | null) =>
  (await http.put<{ route_id: string }>(`/rides/${rideId}/route`, { route_id: routeId })).data;

/** The server accepts at most 100 files per request; larger selections are sent in batches. */
const UPLOAD_BATCH = 50;

function batches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function previewRides(files: File[]) {
  const previews: FilePreview[] = [];
  const errors: Array<{ filename: string; error: string }> = [];
  for (const batch of batches(files, UPLOAD_BATCH)) {
    const form = new FormData();
    for (const f of batch) form.append('files', f);
    const { data } = await http.post<{ previews: FilePreview[]; errors: typeof errors }>(
      '/rides/preview',
      form
    );
    previews.push(...data.previews);
    errors.push(...data.errors);
  }
  return { previews, errors };
}

export async function importRides(
  files: File[],
  fallbackBikeType: BikeType | '',
  options: { skipNonCycling: boolean; useDetectedBikeType: boolean },
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
  const total: ImportResult = {
    imported: [],
    skipped: [],
    errors: [],
    summary: { total: 0, success: 0, skipped: 0, failed: 0 },
  };
  let done = 0;
  for (const batch of batches(files, UPLOAD_BATCH)) {
    const form = new FormData();
    for (const f of batch) form.append('files', f);
    form.append('bike_type', fallbackBikeType);
    form.append('skip_non_cycling', String(options.skipNonCycling));
    form.append('use_detected_bike_type', String(options.useDetectedBikeType));
    const { data } = await http.post<ImportResult>('/rides', form);
    total.imported.push(...data.imported);
    total.skipped.push(...data.skipped);
    total.errors.push(...data.errors);
    for (const k of ['total', 'success', 'skipped', 'failed'] as const)
      total.summary[k] += data.summary[k];
    done += batch.length;
    onProgress?.(done, files.length);
  }
  return total;
}

// ---- routes -----------------------------------------------------------------------------------

export const getRoutes = async (bikeType: BikeFilter) =>
  (await http.get<RouteSummary[]>('/routes', { params: bikeParams(bikeType) })).data;

export const getRoute = async (id: string) => (await http.get<RouteDetail>(`/routes/${id}`)).data;

export const getRouteTracks = async (id: string) =>
  (
    await http.get<Array<{ id: string; date: string | null; track: LatLngTuple[] }>>(
      `/routes/${id}/tracks`
    )
  ).data;

export const renameRoute = async (id: string, name: string) =>
  (await http.patch<RouteSummary>(`/routes/${id}`, { name })).data;

export const mergeRoutes = async (sourceId: string, intoId: string) =>
  (await http.post<RouteSummary>(`/routes/${sourceId}/merge`, { into: intoId })).data;

// ---- sections ---------------------------------------------------------------------------------

export const getSections = async (filters: { bike_type?: BikeType } = {}) =>
  (await http.get<Section[]>('/sections', { params: filters })).data;

export const createSection = async (
  section: Omit<Section, 'id' | 'created_at' | 'ride_title' | 'ride_date'>
) => (await http.post<Section>('/sections', section)).data;

export const updateSection = async (
  id: string,
  updates: Partial<Pick<Section, 'rating' | 'bike_type' | 'surface_tags' | 'notes'>>
) => (await http.put<Section>(`/sections/${id}`, updates)).data;

export const deleteSection = async (id: string) => (await http.delete(`/sections/${id}`)).data;

// ---- map data ---------------------------------------------------------------------------------

export const getHeatmapData = async (bikeType: BikeFilter) =>
  (await http.get<LatLngTuple[]>('/heatmap', { params: bikeParams(bikeType) })).data;

export const getMapBounds = async (bikeType: BikeFilter) =>
  (await http.get<Bounds | null>('/heatmap/bounds', { params: bikeParams(bikeType) })).data;

export const getAllTracks = async (bikeType: BikeFilter) =>
  (await http.get<MapTrack[]>('/heatmap/tracks', { params: bikeParams(bikeType) })).data;

export const getStats = async () => (await http.get<Stats>('/heatmap/stats')).data;

// ---- sync -------------------------------------------------------------------------------------

export const getSyncStatus = async () => (await http.get<SyncStatus>('/sync/status')).data;

export const startSync = async (
  provider: SyncProvider,
  mode: 'incremental' | 'backfill' = 'incremental'
) => (await http.post<{ started: boolean }>(`/sync/${provider}`, { mode })).data;

/** Browser navigation target that starts the Hammerhead OAuth flow. */
export const HAMMERHEAD_CONNECT_URL = '/api/hammerhead/connect';

// ---- planned-route suggestions ------------------------------------------------------------------

export interface SuggestionCandidate {
  planned_route_id: string;
  name: string;
  distance_km: number;
  gain_m: number | null;
  created_at: string | null;
  score: number;
  strength: 'strong' | 'weak';
  distance_diff: number;
  lag_days: number | null;
  reasons: string[];
  other_groups: number;
}

export interface SuggestionGroup {
  route: {
    id: string;
    name: string | null;
    name_source: string | null;
    ride_count: number;
    distance_km: number;
    elevation_gain_m: number | null;
    first_ridden: string | null;
    last_ridden: string | null;
  };
  candidates: SuggestionCandidate[];
}

export interface Suggestions {
  /** `rated`: planned routes named "1S"…"6S" (only those are suggested). */
  planned_routes: { count: number; rated: number; synced_at: string | null; error: string | null };
  counts: { strong: number; weak: number };
  groups: SuggestionGroup[];
}

export const getSuggestions = async (includeWeak: boolean) =>
  (await http.get<Suggestions>('/suggestions', { params: { include_weak: includeWeak } })).data;

export const refreshPlannedRoutes = async () =>
  (await http.post<{ total: number; added: number; deleted: number }>('/suggestions/refresh')).data;

export const acceptSuggestion = async (routeId: string, c: SuggestionCandidate) =>
  (
    await http.post<{ route_id: string; name: string }>('/suggestions/accept', {
      route_id: routeId,
      planned_route_id: c.planned_route_id,
      score: c.score,
    })
  ).data;

export const rejectSuggestion = async (routeId: string, c: SuggestionCandidate) =>
  (
    await http.post('/suggestions/reject', {
      route_id: routeId,
      planned_route_id: c.planned_route_id,
      score: c.score,
    })
  ).data;

export const unlinkPlannedRoute = async (routeId: string) =>
  (await http.delete(`/suggestions/links/${routeId}`)).data;
