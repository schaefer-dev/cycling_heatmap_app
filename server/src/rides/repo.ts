import type { DB } from '../db/connection.ts';
import { stmt } from '../db/stmt.ts';
import type { BikeType, RideDevice } from '../domain.ts';
import { cellNeighbourhood } from '../geo/cells.ts';
import { haversineM, type LatLng } from '../geo/geo.ts';
import type { RideShape } from '../matching/clustering.ts';
import {
  decodePolyline,
  decodeTrack,
  encodePolyline,
  encodeTrack,
  type TrackPoint,
} from '../track/codec.ts';
import { GEOMETRY_VERSION, type RideGeometry } from '../track/geometry.ts';

export interface RideRow {
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
  source: 'gpx' | 'garmin';
  activity_type: string | null;
  garmin_activity_id: number | null;
  route_id: string | null;
  route_similarity: number | null;
  route_direction: 'forward' | 'reverse' | null;
  route_assignment: 'auto' | 'manual' | null;
  created_at: string;
}

export const RIDE_COLUMNS = `id, title, date, start_time, bike_type, bike_type_source, distance_km,
  elevation_gain_m, duration_s, moving_time_s, notes, source, activity_type, garmin_activity_id,
  route_id, route_similarity, route_direction, route_assignment, created_at`;

export interface NewRideRow {
  id: string;
  title: string | null;
  date: string | null;
  startTime: string | null;
  bikeType: BikeType | null;
  bikeTypeSource: 'auto' | 'user' | null;
  distanceKm: number;
  elevationGainM: number;
  durationS: number | null;
  movingTimeS: number | null;
  source: 'gpx' | 'garmin';
  activityType: string | null;
  garminActivityId: number | null;
}

export function insertRide(db: DB, r: NewRideRow): void {
  stmt(
    db,
    `INSERT INTO rides (id, title, date, start_time, bike_type, bike_type_source, distance_km,
       elevation_gain_m, duration_s, moving_time_s, source, activity_type, garmin_activity_id)
     VALUES (@id, @title, @date, @startTime, @bikeType, @bikeTypeSource, @distanceKm,
       @elevationGainM, @durationS, @movingTimeS, @source, @activityType, @garminActivityId)`
  ).run(r);
}

export function getRide(db: DB, id: string): RideRow | undefined {
  return stmt(db, `SELECT ${RIDE_COLUMNS} FROM rides WHERE id = ?`).get(id) as RideRow | undefined;
}

export interface RideFilter {
  bikeType?: BikeType | 'unassigned';
  routeId?: string;
}

function filterSql(f: RideFilter, alias = 'rides'): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (f.bikeType === 'unassigned') clauses.push(`${alias}.bike_type IS NULL`);
  else if (f.bikeType) {
    clauses.push(`${alias}.bike_type = ?`);
    params.push(f.bikeType);
  }
  if (f.routeId) {
    clauses.push(`${alias}.route_id = ?`);
    params.push(f.routeId);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export function listRides(db: DB, f: RideFilter = {}): RideRow[] {
  const { where, params } = filterSql(f);
  return db
    .prepare(
      `SELECT ${RIDE_COLUMNS} FROM rides ${where}
       ORDER BY COALESCE(start_time, date) DESC, created_at DESC`
    )
    .all(...params) as RideRow[];
}

export function updateRide(
  db: DB,
  id: string,
  patch: { title?: string; notes?: string | null; bikeType?: BikeType | null }
): void {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (patch.title !== undefined) {
    sets.push('title = ?');
    params.push(patch.title);
  }
  if (patch.notes !== undefined) {
    sets.push('notes = ?');
    params.push(patch.notes);
  }
  if (patch.bikeType !== undefined) {
    sets.push(`bike_type = ?, bike_type_source = 'user'`);
    params.push(patch.bikeType);
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE rides SET ${sets.join(', ')} WHERE id = ?`).run(...params, id);
}

export function deleteRide(db: DB, id: string): boolean {
  return stmt(db, `DELETE FROM rides WHERE id = ?`).run(id).changes > 0;
}

// ---- tracks ---------------------------------------------------------------------------------

export function saveTrack(db: DB, rideId: string, points: readonly TrackPoint[]): void {
  const enc = encodeTrack(points);
  stmt(
    db,
    `INSERT OR REPLACE INTO ride_tracks (ride_id, t0, point_count, points) VALUES (?, ?, ?, ?)`
  ).run(rideId, enc.t0, enc.count, enc.blob);
}

export function loadTrack(db: DB, rideId: string): TrackPoint[] | null {
  const row = stmt(db, `SELECT t0, points FROM ride_tracks WHERE ride_id = ?`).get(rideId) as
    { t0: number | null; points: Buffer } | undefined;
  return row ? decodeTrack(row.points, row.t0) : null;
}

// ---- derived geometry -----------------------------------------------------------------------

export function saveGeometry(db: DB, rideId: string, g: RideGeometry): void {
  stmt(
    db,
    `INSERT OR REPLACE INTO ride_geometry (ride_id, version, length_m, min_lat, min_lng, max_lat,
       max_lng, start_lat, start_lng, end_lat, end_lng, resampled, display)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    rideId,
    GEOMETRY_VERSION,
    g.lengthM,
    g.bbox.minLat,
    g.bbox.minLng,
    g.bbox.maxLat,
    g.bbox.maxLng,
    g.start.lat,
    g.start.lng,
    g.end.lat,
    g.end.lng,
    encodePolyline(g.resampled),
    encodePolyline(g.display)
  );
  stmt(db, `DELETE FROM ride_cells WHERE ride_id = ?`).run(rideId);
  const insertCell = stmt(db, `INSERT OR IGNORE INTO ride_cells (cell, ride_id) VALUES (?, ?)`);
  for (const cell of g.cells) insertCell.run(cell, rideId);
}

export function rideIdsNeedingGeometry(db: DB): string[] {
  return (
    stmt(
      db,
      `SELECT r.id FROM rides r LEFT JOIN ride_geometry g ON g.ride_id = r.id
       WHERE g.ride_id IS NULL OR g.version < ?`
    ).all(GEOMETRY_VERSION) as Array<{ id: string }>
  ).map((r) => r.id);
}

interface ShapeRow {
  id: string;
  start_time: string | null;
  date: string | null;
  created_at: string;
  length_m: number;
  min_lat: number;
  min_lng: number;
  max_lat: number;
  max_lng: number;
  resampled: Buffer;
}

const SHAPE_SQL = `SELECT r.id, r.start_time, r.date, r.created_at, g.length_m, g.min_lat, g.min_lng,
  g.max_lat, g.max_lng, g.resampled FROM rides r JOIN ride_geometry g ON g.ride_id = r.id`;

function toShape(row: ShapeRow): RideShape {
  const time = Date.parse(row.start_time ?? row.date ?? row.created_at);
  return {
    id: row.id,
    time: Number.isFinite(time) ? time : 0,
    lengthM: row.length_m,
    bbox: { minLat: row.min_lat, minLng: row.min_lng, maxLat: row.max_lat, maxLng: row.max_lng },
    line: decodePolyline(row.resampled),
  };
}

export function loadShape(db: DB, rideId: string): RideShape | null {
  const row = stmt(db, `${SHAPE_SQL} WHERE r.id = ?`).get(rideId) as ShapeRow | undefined;
  return row ? toShape(row) : null;
}

export function loadAllShapes(db: DB): RideShape[] {
  return (stmt(db, SHAPE_SQL).all() as ShapeRow[]).map(toShape);
}

export function loadDisplayLine(db: DB, rideId: string): LatLng[] | null {
  const row = stmt(db, `SELECT display FROM ride_geometry WHERE ride_id = ?`).get(rideId) as
    { display: Buffer } | undefined;
  return row ? decodePolyline(row.display) : null;
}

/** Rides passing within `radiusM` of a point (cell lookup, then exact check on the geometry). */
export function ridesNear(db: DB, lat: number, lng: number, radiusM: number, f: RideFilter = {}) {
  const cells = cellNeighbourhood(lat, lng);
  const { where, params } = filterSql(f, 'r');
  const rows = db
    .prepare(
      `SELECT ${RIDE_COLUMNS.split(',')
        .map((c) => `r.${c.trim()}`)
        .join(', ')}, g.resampled
       FROM rides r JOIN ride_geometry g ON g.ride_id = r.id
       ${where ? `${where} AND` : 'WHERE'}
       r.id IN (SELECT DISTINCT ride_id FROM ride_cells WHERE cell IN (${cells.map(() => '?').join(',')}))
       ORDER BY COALESCE(r.start_time, r.date) DESC`
    )
    .all(...params, ...cells) as Array<RideRow & { resampled: Buffer }>;
  return rows
    .filter((r) =>
      decodePolyline(r.resampled).some((p) => haversineM(lat, lng, p.lat, p.lng) <= radiusM)
    )
    .map(({ resampled: _resampled, ...ride }) => ride as RideRow);
}

// ---- duplicates -----------------------------------------------------------------------------

export function findByGarminId(db: DB, garminActivityId: number): RideRow | undefined {
  return stmt(db, `SELECT ${RIDE_COLUMNS} FROM rides WHERE garmin_activity_id = ?`).get(
    garminActivityId
  ) as RideRow | undefined;
}

/** Rides whose recording started within `toleranceS` of `startMs`. */
export function findByStartTime(db: DB, startMs: number, toleranceS: number): RideRow[] {
  const from = new Date(startMs - toleranceS * 1000).toISOString();
  const to = new Date(startMs + toleranceS * 1000).toISOString();
  return stmt(
    db,
    `SELECT ${RIDE_COLUMNS} FROM rides WHERE start_time BETWEEN ? AND ? ORDER BY start_time`
  ).all(from, to) as RideRow[];
}

/** Fallback for files without timestamps: same day, same length, same start and end. */
export function findSimilarUntimed(
  db: DB,
  date: string | null,
  distanceKm: number,
  start: LatLng,
  end: LatLng
): RideRow | undefined {
  const rows = stmt(
    db,
    `SELECT ${RIDE_COLUMNS.split(',')
      .map((c) => `r.${c.trim()}`)
      .join(', ')},
       g.start_lat, g.start_lng, g.end_lat, g.end_lng
     FROM rides r JOIN ride_geometry g ON g.ride_id = r.id
     WHERE r.date IS ? AND ABS(r.distance_km - ?) < 0.2`
  ).all(date, distanceKm) as Array<
    RideRow & { start_lat: number; start_lng: number; end_lat: number; end_lng: number }
  >;
  return rows.find(
    (r) =>
      haversineM(r.start_lat, r.start_lng, start.lat, start.lng) < 50 &&
      haversineM(r.end_lat, r.end_lng, end.lat, end.lng) < 50
  );
}

// ---- devices --------------------------------------------------------------------------------

export function saveDevices(db: DB, rideId: string, devices: readonly RideDevice[]): void {
  stmt(db, `DELETE FROM ride_devices WHERE ride_id = ?`).run(rideId);
  const ins = stmt(
    db,
    `INSERT INTO ride_devices (ride_id, device_index, device_type, source_type, manufacturer,
       product, product_name, serial_number, ant_device_number)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const d of devices) {
    ins.run(
      rideId,
      d.deviceIndex,
      d.deviceType,
      d.sourceType,
      d.manufacturer,
      d.product,
      d.productName,
      d.serialNumber,
      d.antDeviceNumber
    );
  }
}

export function listDevices(db: DB, rideId: string) {
  return stmt(
    db,
    `SELECT device_index, device_type, source_type, manufacturer, product, product_name,
       serial_number, ant_device_number FROM ride_devices WHERE ride_id = ? ORDER BY id`
  ).all(rideId);
}
