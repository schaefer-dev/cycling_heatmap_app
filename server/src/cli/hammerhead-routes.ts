/**
 * npm run hammerhead:routes
 * Read-only: lists the planned routes in the connected Hammerhead library and checks which route
 * geometry the API offers (polyline in the list, or the undocumented per-route / file endpoints).
 * Needs the `route:read` permission: reconnect Hammerhead in the UI if it reports a missing one.
 */
import { loadConfig } from '../config.ts';
import { openDatabase } from '../db/connection.ts';
import { dbTokenStore } from '../hammerhead/auth.ts';
import {
  HammerheadScopeError,
  MAX_PAGE_SIZE,
  createHammerheadClient,
  type HammerheadRouteSummary,
} from '../hammerhead/client.ts';

const config = loadConfig();
if (!config.hammerhead) {
  console.error('HAMMERHEAD_CLIENT_ID / HAMMERHEAD_CLIENT_SECRET are not set in .env');
  process.exit(1);
}
const db = openDatabase(config.dbPath);
const tokens = dbTokenStore(db);
if (!tokens.load()) {
  console.error('Hammerhead is not connected: use "Connect Hammerhead" in the UI first');
  process.exit(1);
}
const client = createHammerheadClient({ ...config.hammerhead, tokens });

const routes: Array<HammerheadRouteSummary & Record<string, unknown>> = [];
try {
  for (let page = 1; ; page++) {
    const res = await client.listRoutes(page, MAX_PAGE_SIZE);
    routes.push(...(res.data as typeof routes));
    if (res.data.length === 0 || page >= (res.totalPages ?? page)) break;
  }
} catch (e) {
  if (e instanceof HammerheadScopeError) {
    const connectUrl = new URL('/api/hammerhead/connect', config.hammerhead.redirectUri);
    console.error(`${e.message}\nReconnect by opening ${connectUrl} in the browser.`);
    process.exit(2);
  }
  throw e;
}

const keys = new Set(routes.flatMap((r) => Object.keys(r)));
console.log(`Routes: ${routes.length}`);
console.log(`List fields: ${[...keys].sort().join(', ')}`);
console.log(
  `Polyline in list: ${routes.filter((r) => typeof r.polyline === 'string').length}/${routes.length}`
);
for (const r of routes.slice(0, 15)) {
  const km = typeof r.distance === 'number' ? `${(r.distance / 1000).toFixed(1)} km` : '?';
  console.log(`  ${r.createdAt?.slice(0, 10) ?? '?'}  ${km.padStart(9)}  ${r.name ?? '(no name)'}`);
}
if (routes.length > 15) console.log(`  … ${routes.length - 15} more`);

const first = routes[0];
if (first) {
  const id = encodeURIComponent(first.id);
  for (const path of [`/routes/${id}`, `/routes/${id}/file`]) {
    const res = await client.rawGet(path);
    const text = new TextDecoder().decode(res.body.subarray(0, 200));
    let shape = `${res.body.length} bytes`;
    if (res.contentType?.includes('json')) {
      try {
        const json = JSON.parse(new TextDecoder().decode(res.body)) as Record<string, unknown>;
        shape = `JSON keys: ${Object.keys(json).sort().join(', ')}; polyline: ${typeof json.polyline === 'string' ? `${json.polyline.length} chars` : 'no'}`;
      } catch {
        shape = `invalid JSON: ${text.slice(0, 80)}`;
      }
    } else if (res.body.length > 12 && text.slice(8, 12) === '.FIT') {
      shape = `FIT file, ${res.body.length} bytes`;
    } else if (/^\s*<\?xml|<gpx/i.test(text)) {
      shape = `XML/GPX, ${res.body.length} bytes`;
    }
    console.log(
      `GET ${path.replace(id, '<id>')} → HTTP ${res.status} (${res.contentType ?? 'no type'}): ${shape}`
    );
  }
}
db.close();
