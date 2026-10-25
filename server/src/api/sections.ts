import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import type { AppContext } from '../app.ts';
import { BIKE_TYPES, RATINGS, SURFACE_TAGS } from '../domain.ts';
import { NotFoundError } from '../errors.ts';
import { getRide } from '../rides/repo.ts';
import { parse, safeJson } from './http.ts';

const idParam = z.object({ id: z.string().min(1) });
const lat = z.number().min(-90).max(90);
const lng = z.number().min(-180).max(180);
const index = z.number().int().nonnegative().nullable().optional();

const listQuery = z.object({
  bike_type: z.enum(BIKE_TYPES).optional(),
  rating: z.enum(RATINGS).optional(),
  ride_id: z.string().optional(),
});

const createBody = z.object({
  ride_id: z.string().min(1),
  start_lat: lat,
  start_lng: lng,
  start_index: index,
  end_lat: lat,
  end_lng: lng,
  end_index: index,
  track_segment: z
    .array(z.tuple([lat, lng]))
    .max(100_000)
    .nullable()
    .optional(),
  rating: z.enum(RATINGS),
  bike_type: z.enum(BIKE_TYPES),
  surface_tags: z.array(z.enum(SURFACE_TAGS)).default([]),
  notes: z.string().max(5000).nullable().optional(),
});

const updateBody = z
  .object({
    rating: z.enum(RATINGS).optional(),
    bike_type: z.enum(BIKE_TYPES).optional(),
    surface_tags: z.array(z.enum(SURFACE_TAGS)).optional(),
    notes: z.string().max(5000).nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, 'No fields to update');

interface SectionRow {
  surface_tags: string | null;
  track_segment: string | null;
  [key: string]: unknown;
}

function toJson(s: SectionRow) {
  return {
    ...s,
    surface_tags: safeJson<string[]>(s.surface_tags, []),
    track_segment: safeJson<[number, number][] | null>(s.track_segment, null),
  };
}

const SELECT = `SELECT s.*, r.title AS ride_title, r.date AS ride_date
  FROM sections s LEFT JOIN rides r ON s.ride_id = r.id`;

export function sectionsRouter(ctx: AppContext): Router {
  const { db } = ctx;
  const router = Router();
  const getSection = (id: string) =>
    db.prepare(`${SELECT} WHERE s.id = ?`).get(id) as SectionRow | undefined;

  router.get('/', (req, res) => {
    const q = parse(listQuery, req.query);
    const clauses: string[] = [];
    const params: unknown[] = [];
    if (q.bike_type) {
      clauses.push('s.bike_type = ?');
      params.push(q.bike_type);
    }
    if (q.rating) {
      clauses.push('s.rating = ?');
      params.push(q.rating);
    }
    if (q.ride_id) {
      clauses.push('s.ride_id = ?');
      params.push(q.ride_id);
    }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = db
      .prepare(`${SELECT} ${where} ORDER BY s.created_at DESC`)
      .all(...params) as SectionRow[];
    res.json(rows.map(toJson));
  });

  router.get('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const section = getSection(id);
    if (!section) throw new NotFoundError('Section not found');
    res.json(toJson(section));
  });

  router.post('/', (req, res) => {
    const b = parse(createBody, req.body);
    if (!getRide(db, b.ride_id)) throw new NotFoundError('Ride not found');
    const id = randomUUID();
    db.prepare(
      `INSERT INTO sections (id, ride_id, start_lat, start_lng, start_index, end_lat, end_lng,
         end_index, track_segment, rating, bike_type, surface_tags, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      b.ride_id,
      b.start_lat,
      b.start_lng,
      b.start_index ?? null,
      b.end_lat,
      b.end_lng,
      b.end_index ?? null,
      b.track_segment ? JSON.stringify(b.track_segment) : null,
      b.rating,
      b.bike_type,
      JSON.stringify(b.surface_tags),
      b.notes ?? null
    );
    res.status(201).json(toJson(getSection(id)!));
  });

  router.put('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const b = parse(updateBody, req.body);
    if (!getSection(id)) throw new NotFoundError('Section not found');
    const fields: Record<string, unknown> = {
      rating: b.rating,
      bike_type: b.bike_type,
      surface_tags: b.surface_tags === undefined ? undefined : JSON.stringify(b.surface_tags),
      notes: b.notes,
    };
    const entries = Object.entries(fields).filter(([, v]) => v !== undefined);
    db.prepare(
      `UPDATE sections SET ${entries.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`
    ).run(...entries.map(([, v]) => v), id);
    res.json(toJson(getSection(id)!));
  });

  router.delete('/:id', (req, res) => {
    const { id } = parse(idParam, req.params);
    const { changes } = db.prepare(`DELETE FROM sections WHERE id = ?`).run(id);
    if (changes === 0) throw new NotFoundError('Section not found');
    res.json({ success: true });
  });

  return router;
}
