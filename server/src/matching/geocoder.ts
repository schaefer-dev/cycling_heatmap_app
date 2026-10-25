/**
 * Reverse geocoding (coordinates → place name) via OpenStreetMap Nominatim, used only for naming
 * routes. Respects the public usage policy: ≤ 1 request/s, identifying User-Agent, results cached.
 */
import type { DB } from '../db/connection.ts';
import { logger } from '../logger.ts';

export interface Geocoder {
  placeName(lat: number, lng: number): Promise<string | null>;
}

export const nullGeocoder: Geocoder = { placeName: async () => null };

interface NominatimOptions {
  baseUrl: string;
  userAgent: string;
  language: string;
  fetchFn?: typeof fetch;
  minIntervalMs?: number;
}

export function createNominatimGeocoder(db: DB, opts: NominatimOptions): Geocoder {
  const fetchFn = opts.fetchFn ?? fetch;
  const minInterval = opts.minIntervalMs ?? 1100;
  let nextSlot = 0;
  const getCached = db.prepare(`SELECT place FROM geocode_cache WHERE key = ?`);
  const putCached = db.prepare(`INSERT OR REPLACE INTO geocode_cache (key, place) VALUES (?, ?)`);

  return {
    async placeName(lat, lng) {
      // ~100 m buckets: nearby starts share the cache entry.
      const key = `${lat.toFixed(3)},${lng.toFixed(3)}`;
      const cached = getCached.get(key) as { place: string | null } | undefined;
      if (cached) return cached.place;

      const wait = nextSlot - Date.now();
      nextSlot = Math.max(Date.now(), nextSlot) + minInterval;
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));

      const url = new URL('/reverse', opts.baseUrl);
      url.search = new URLSearchParams({
        format: 'jsonv2',
        lat: String(lat),
        lon: String(lng),
        zoom: '14',
        'accept-language': opts.language,
      }).toString();
      try {
        const res = await fetchFn(url, { headers: { 'User-Agent': opts.userAgent } });
        if (!res.ok) {
          logger.warn(`Geocoder returned HTTP ${res.status}`);
          return null; // not cached: retried next time
        }
        const body = (await res.json()) as { address?: Record<string, string> };
        const a = body.address ?? {};
        const place =
          a.village ??
          a.town ??
          a.city ??
          a.suburb ??
          a.hamlet ??
          a.municipality ??
          a.county ??
          null;
        putCached.run(key, place);
        return place;
      } catch (e) {
        logger.warn(`Geocoder request failed: ${(e as Error).message}`);
        return null;
      }
    },
  };
}
