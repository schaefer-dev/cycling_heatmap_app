/**
 * Compact binary storage for tracks (instead of one SQLite row per GPS point).
 *
 * Full track layout (little endian, columnar), `n` points:
 *   int32 lat*1e7 [n] | int32 lng*1e7 [n] | float32 elevation [n] (NaN = none) | int32 ms since t0 [n] (MIN = none)
 * `t0` (unix ms of the first timestamped point) is stored next to the blob.
 *
 * Polyline layout (geometry for matching/drawing): int32 lat*1e7 [n] | int32 lng*1e7 [n]
 */
import type { LatLng } from '../geo/geo.ts';

export interface TrackPoint {
  lat: number;
  lng: number;
  ele: number | null;
  /** Unix epoch milliseconds. */
  time: number | null;
}

const SCALE = 1e7;
const NO_TIME = -2147483648;

export interface EncodedTrack {
  blob: Buffer;
  t0: number | null;
  count: number;
}

export function encodeTrack(points: readonly TrackPoint[]): EncodedTrack {
  const n = points.length;
  const t0 = points.find((p) => p.time !== null)?.time ?? null;
  const buf = Buffer.alloc(n * 16);
  for (let i = 0; i < n; i++) {
    const p = points[i]!;
    buf.writeInt32LE(Math.round(p.lat * SCALE), i * 4);
    buf.writeInt32LE(Math.round(p.lng * SCALE), (n + i) * 4);
    buf.writeFloatLE(p.ele ?? Number.NaN, (2 * n + i) * 4);
    const offset = p.time === null || t0 === null ? NO_TIME : clampInt32(p.time - t0);
    buf.writeInt32LE(offset, (3 * n + i) * 4);
  }
  return { blob: buf, t0, count: n };
}

export function decodeTrack(blob: Uint8Array, t0: number | null): TrackPoint[] {
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const n = buf.length / 16;
  if (!Number.isInteger(n)) throw new Error(`Corrupt track blob (${buf.length} bytes)`);
  const out: TrackPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const ele = buf.readFloatLE((2 * n + i) * 4);
    const offset = buf.readInt32LE((3 * n + i) * 4);
    out[i] = {
      lat: buf.readInt32LE(i * 4) / SCALE,
      lng: buf.readInt32LE((n + i) * 4) / SCALE,
      ele: Number.isNaN(ele) ? null : ele,
      time: offset === NO_TIME || t0 === null ? null : t0 + offset,
    };
  }
  return out;
}

export function encodePolyline(points: readonly LatLng[]): Buffer {
  const n = points.length;
  const buf = Buffer.alloc(n * 8);
  for (let i = 0; i < n; i++) {
    buf.writeInt32LE(Math.round(points[i]!.lat * SCALE), i * 4);
    buf.writeInt32LE(Math.round(points[i]!.lng * SCALE), (n + i) * 4);
  }
  return buf;
}

export function decodePolyline(blob: Uint8Array): LatLng[] {
  const buf = Buffer.from(blob.buffer, blob.byteOffset, blob.byteLength);
  const n = buf.length / 8;
  if (!Number.isInteger(n)) throw new Error(`Corrupt polyline blob (${buf.length} bytes)`);
  const out: LatLng[] = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = { lat: buf.readInt32LE(i * 4) / SCALE, lng: buf.readInt32LE((n + i) * 4) / SCALE };
  }
  return out;
}

function clampInt32(v: number): number {
  return Math.max(NO_TIME + 1, Math.min(2147483647, Math.round(v)));
}
