/**
 * Regenerates `routes.json`, the road geometry behind the demo dataset (`npm run demo:seed`).
 * Dev-only, not needed to seed: node server/src/demo/fetch-routes.ts
 *
 * Loops around Girona (Spain), a well-known cycling hub, so the demo shows real roads without
 * anyone's personal data. Geometry: OSRM bike profile (routing.openstreetmap.de, © OpenStreetMap
 * contributors, ODbL); elevation: Open-Meteo (Copernicus DEM), sampled sparsely and interpolated.
 */
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { distanceM, simplify, type LatLng } from '../geo/geo.ts';
import type { DemoRoute, DemoRoutesFile } from './seed.ts';

type Waypoint = [lng: number, lat: number];

const GIRONA: Waypoint = [2.8241, 41.9846];

const TEMPLATES: Array<Omit<DemoRoute, 'points'> & { via: Waypoint[] }> = [
  {
    id: 'angels',
    name: 'Els Àngels',
    bikeType: 'road',
    via: [GIRONA, [2.888, 41.959], [2.9644, 41.9853], [2.8817, 42.0336], GIRONA],
  },
  {
    id: 'rocacorba',
    name: 'Rocacorba',
    bikeType: 'road',
    via: [GIRONA, [2.7663, 42.1187], [2.7, 42.087], [2.683, 42.0703], [2.7448, 42.0322], GIRONA],
  },
  {
    id: 'banyoles',
    name: 'Banyoles lake',
    bikeType: 'road',
    via: [GIRONA, [2.817, 42.083], [2.7663, 42.1187], [2.747, 42.117], [2.7553, 41.9897], GIRONA],
  },
  {
    id: 'coast',
    name: 'Sant Feliu coast',
    bikeType: 'road',
    via: [
      GIRONA,
      [2.8749, 41.8866],
      [2.8935, 41.8269],
      [3.028, 41.7817],
      [3.0663, 41.8178],
      [2.9998, 41.8125],
      [2.8935, 41.8269],
      GIRONA,
    ],
  },
  {
    id: 'bisbal',
    name: 'La Bisbal',
    bikeType: 'road',
    via: [
      GIRONA,
      [2.8394, 41.9409],
      [3.0386, 41.9603],
      [3.0094, 41.9886],
      [2.905, 42.0434],
      GIRONA,
    ],
  },
  {
    id: 'olot',
    name: 'Besalú – Olot',
    bikeType: 'road',
    via: [
      GIRONA,
      [2.7663, 42.1187],
      [2.6994, 42.1993],
      [2.5506, 42.2203],
      [2.4891, 42.1822],
      [2.5418, 42.0565],
      [2.6403, 41.9556],
      GIRONA,
    ],
  },
  {
    id: 'ter',
    name: 'Ter river',
    bikeType: 'road',
    via: [GIRONA, [2.8475, 42.0342], [2.8466, 42.0558], [2.8817, 42.0336], GIRONA],
  },
  {
    id: 'carrilet',
    name: 'Carrilet greenway',
    bikeType: 'gravel',
    via: [
      GIRONA,
      [2.7392, 41.9629],
      [2.668, 41.9306],
      [2.6403, 41.9556],
      [2.7392, 41.9629],
      GIRONA,
    ],
  },
  {
    id: 'hilari',
    name: 'Sant Hilari',
    bikeType: 'road',
    via: [
      GIRONA,
      [2.6403, 41.9556],
      [2.5531, 41.9479],
      [2.5118, 41.88],
      [2.684, 41.903],
      [2.7928, 41.9747],
      GIRONA,
    ],
  },
  {
    id: 'pubol',
    name: 'Púbol',
    bikeType: 'gravel',
    via: [
      GIRONA,
      [2.8817, 42.0336],
      [2.9831, 42.0187],
      [2.9644, 41.9853],
      [2.9285, 41.9839],
      GIRONA,
    ],
  },
  {
    id: 'tossa',
    name: 'Tossa de Mar',
    bikeType: 'road',
    via: [
      GIRONA,
      [2.8749, 41.8866],
      [2.8935, 41.8269],
      [2.9324, 41.7205],
      [3.028, 41.7817],
      [2.9998, 41.8125],
      GIRONA,
    ],
  },
  {
    id: 'gavarres',
    name: 'Gavarres',
    bikeType: 'mtb',
    via: [GIRONA, [2.888, 41.959], [2.9285, 41.9839], [2.8394, 41.9409], GIRONA],
  },
];

const ELEVATION_SAMPLE_M = 300;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function getJson<T>(url: string): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { headers: { 'User-Agent': 'ridestack-demo/1.0' } });
    if (res.ok) return (await res.json()) as T;
    // Open-Meteo counts every coordinate as a call (per-minute limit): wait and retry.
    if (res.status !== 429 || attempt === 6) throw new Error(`${res.status} ${res.statusText}`);
    console.log('Rate limited, waiting a minute...');
    await sleep(65_000);
  }
}

async function route(via: Waypoint[]): Promise<LatLng[]> {
  const coords = via.map(([lng, lat]) => `${lng},${lat}`).join(';');
  const url = `https://routing.openstreetmap.de/routed-bike/route/v1/driving/${coords}?overview=full&geometries=geojson`;
  const body = await getJson<{ routes: Array<{ geometry: { coordinates: Waypoint[] } }> }>(url);
  return body.routes[0]!.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
}

/** Elevations for `points`: sampled every ELEVATION_SAMPLE_M, linearly interpolated in between. */
async function elevations(points: LatLng[]): Promise<number[]> {
  const along = [0];
  for (let i = 1; i < points.length; i++)
    along.push(along[i - 1]! + distanceM(points[i - 1]!, points[i]!));
  const sampleIdx: number[] = [];
  let next = 0;
  for (let i = 0; i < points.length; i++) {
    if (along[i]! >= next || i === points.length - 1) {
      sampleIdx.push(i);
      next = along[i]! + ELEVATION_SAMPLE_M;
    }
  }
  const sampled: number[] = [];
  for (let i = 0; i < sampleIdx.length; i += 100) {
    const chunk = sampleIdx.slice(i, i + 100).map((k) => points[k]!);
    const lat = chunk.map((p) => p.lat.toFixed(5)).join(',');
    const lng = chunk.map((p) => p.lng.toFixed(5)).join(',');
    const body = await getJson<{ elevation: number[] }>(
      `https://api.open-meteo.com/v1/elevation?latitude=${lat}&longitude=${lng}`
    );
    sampled.push(...body.elevation);
    await sleep(500);
  }
  return points.map((_, i) => {
    let s = sampleIdx.findIndex((k) => k >= i);
    if (sampleIdx[s] === i) return sampled[s]!;
    s = Math.max(1, s);
    const [a, b] = [sampleIdx[s - 1]!, sampleIdx[s]!];
    const t = (along[i]! - along[a]!) / (along[b]! - along[a]! || 1);
    return sampled[s - 1]! + (sampled[s]! - sampled[s - 1]!) * t;
  });
}

const routes: DemoRoute[] = [];
for (const { via, ...meta } of TEMPLATES) {
  const line = simplify(await route(via), 2);
  const ele = await elevations(line);
  routes.push({
    ...meta,
    points: line.map((p, i) => [+p.lat.toFixed(5), +p.lng.toFixed(5), Math.round(ele[i]!)]),
  });
  console.log(`${meta.id}: ${line.length} points`);
  await sleep(1000);
}

const file: DemoRoutesFile = {
  attribution:
    'Road geometry © OpenStreetMap contributors (ODbL), elevation: Open-Meteo / Copernicus DEM',
  routes,
};
const out = path.join(import.meta.dirname, 'routes.json');
writeFileSync(out, JSON.stringify(file) + '\n');
console.log(`Wrote ${out}`);
