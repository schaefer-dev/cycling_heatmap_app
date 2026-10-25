/**
 * npm run routes:rebuild
 * Re-clusters all rides into routes (keeps manual assignments and user-given names), then names
 * new routes. Stop the server first.
 */
import { bootstrap } from '../bootstrap.ts';
import { loadConfig } from '../config.ts';

const services = await bootstrap(loadConfig());
const result = services.routes.rebuild();
console.log(`${result.rides} rides → ${result.routes} routes (${result.ms} ms). Naming routes...`);
const named = await services.routes.nameRoutes();
console.log(`Named ${named} route(s).`);
services.db.close();
