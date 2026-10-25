import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { decodePolyline } from '../track/codec.ts';
import { bikeTypeFilter, parse } from './http.ts';

const filterQuery = z.object({ bike_type: bikeTypeFilter });

function bikeWhere(bikeType: string | undefined): { sql: string; params: unknown[] } {
  if (!bikeType) return { sql: '', params: [] };
  if (bikeType === 'unassigned') return { sql: 'WHERE r.bike_type IS NULL', params: [] };
  return { sql: 'WHERE r.bike_type = ?', params: [bikeType] };
}

const round5 = (v: number) => Math.round(v * 1e5) / 1e5;

export function heatmapRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const router = Router();

  /**
   * Heatmap points: each ride's uniformly resampled line, thinned to ~50 m spacing. Uniform spacing
   * means every metre ridden weighs the same, regardless of the recorder's sampling rate.
   */
  router.get('/', (req, res) => {
    const { bike_type } = parse(filterQuery, req.query);
    const where = bikeWhere(bike_type);
    const rows = db
      .prepare(
        `SELECT g.resampled FROM ride_geometry g JOIN rides r ON r.id = g.ride_id ${where.sql}`
      )
      .all(...where.params) as Array<{ resampled: Buffer }>;
    const points: Array<[number, number]> = [];
    for (const row of rows) {
      const line = decodePolyline(row.resampled);
      for (let i = 0; i < line.length; i += 2)
        points.push([round5(line[i]!.lat), round5(line[i]!.lng)]);
    }
    res.json(points);
  });

  router.get('/bounds', (req, res) => {
    const { bike_type } = parse(filterQuery, req.query);
    const where = bikeWhere(bike_type);
    const b = db
      .prepare(
        `SELECT MIN(g.min_lat) AS min_lat, MIN(g.min_lng) AS min_lng, MAX(g.max_lat) AS max_lat,
           MAX(g.max_lng) AS max_lng, COUNT(*) AS n
         FROM ride_geometry g JOIN rides r ON r.id = g.ride_id ${where.sql}`
      )
      .get(...where.params) as {
      min_lat: number;
      min_lng: number;
      max_lat: number;
      max_lng: number;
      n: number;
    };
    if (b.n === 0) {
      res.json(null);
      return;
    }
    res.json({
      southwest: [b.min_lat, b.min_lng],
      northeast: [b.max_lat, b.max_lng],
      center: [(b.min_lat + b.max_lat) / 2, (b.min_lng + b.max_lng) / 2],
    });
  });

  /** Every ride's simplified line with metadata, for "show all tracks" (single query). */
  router.get('/tracks', (req, res) => {
    const { bike_type } = parse(filterQuery, req.query);
    const where = bikeWhere(bike_type);
    const rows = db
      .prepare(
        `SELECT r.id, r.title, r.bike_type, r.date, r.distance_km, r.route_id, g.display
         FROM rides r JOIN ride_geometry g ON g.ride_id = r.id ${where.sql}
         ORDER BY COALESCE(r.start_time, r.date) DESC`
      )
      .all(...where.params) as Array<Record<string, unknown> & { display: Buffer }>;
    res.json(
      rows.map(({ display, ...ride }) => ({
        ...ride,
        track: decodePolyline(display).map((p) => [round5(p.lat), round5(p.lng)]),
      }))
    );
  });

  router.get('/stats', (_req, res) => {
    const r = db
      .prepare(
        `SELECT COUNT(*) AS total, SUM(distance_km) AS distance, SUM(elevation_gain_m) AS elevation,
           COUNT(CASE WHEN bike_type = 'road' THEN 1 END) AS road,
           COUNT(CASE WHEN bike_type = 'gravel' THEN 1 END) AS gravel,
           COUNT(CASE WHEN bike_type = 'mtb' THEN 1 END) AS mtb,
           COUNT(CASE WHEN bike_type IS NULL THEN 1 END) AS unassigned
         FROM rides`
      )
      .get() as Record<string, number | null>;
    const s = db
      .prepare(
        `SELECT COUNT(*) AS total,
           COUNT(CASE WHEN rating = 'excellent' THEN 1 END) AS excellent,
           COUNT(CASE WHEN rating = 'good' THEN 1 END) AS good,
           COUNT(CASE WHEN rating = 'challenging' THEN 1 END) AS challenging,
           COUNT(CASE WHEN rating = 'hard' THEN 1 END) AS hard,
           COUNT(CASE WHEN rating = 'unridable' THEN 1 END) AS unridable
         FROM sections`
      )
      .get() as Record<string, number>;
    const routes = db
      .prepare(
        `SELECT COUNT(*) AS total, COUNT(CASE WHEN n > 1 THEN 1 END) AS repeated
         FROM (SELECT route_id, COUNT(*) AS n FROM rides WHERE route_id IS NOT NULL GROUP BY route_id)`
      )
      .get() as { total: number; repeated: number };
    res.json({
      rides: {
        total: r.total,
        total_distance_km: Math.round(r.distance ?? 0),
        total_elevation_m: Math.round(r.elevation ?? 0),
        by_type: { road: r.road, gravel: r.gravel, mtb: r.mtb, unassigned: r.unassigned },
      },
      routes,
      sections: {
        total: s.total,
        by_rating: {
          excellent: s.excellent,
          good: s.good,
          challenging: s.challenging,
          hard: s.hard,
          unridable: s.unridable,
        },
      },
    });
  });

  return router;
}
