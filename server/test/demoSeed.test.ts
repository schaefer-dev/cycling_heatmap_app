import { describe, expect, it } from 'vitest';
import { loadDemoRoutes, seedDemo, type DemoRoutesFile } from '../src/demo/seed.ts';
import { testContext } from './helpers/context.ts';

/** Two short loops keep the test fast; the full file is only checked structurally. */
function subset(ids: string[]): DemoRoutesFile {
  const file = loadDemoRoutes();
  return { ...file, routes: file.routes.filter((r) => ids.includes(r.id)) };
}

describe('demo dataset', () => {
  it('ships a dozen loops with elevation', () => {
    const { routes } = loadDemoRoutes();
    expect(routes.length).toBeGreaterThanOrEqual(10);
    for (const r of routes) {
      expect(r.points.length).toBeGreaterThan(100);
      expect(
        r.points.every(([lat, lng, ele]) => lat > 41 && lat < 43 && lng > 2 && lng < 4 && ele > -10)
      ).toBe(true);
    }
  });

  it('imports repeated rides that group into one route per loop', async () => {
    const ctx = await testContext();
    const result = await seedDemo(ctx, subset(['ter', 'pubol']));

    expect(result).toEqual({ rides: 26, routes: 2 });
    const named = ctx.db
      .prepare(`SELECT name, name_source FROM routes ORDER BY name`)
      .all() as Array<{ name: string; name_source: string }>;
    expect(named).toContainEqual({ name: '3SG Púbol', name_source: 'title' });
    const stats = ctx.db
      .prepare(
        `SELECT MIN(distance_km) AS min, MAX(distance_km) AS max, COUNT(DISTINCT date) AS days FROM rides`
      )
      .get() as { min: number; max: number; days: number };
    expect(stats.min).toBeGreaterThan(25);
    expect(stats.max).toBeLessThan(50);
    expect(stats.days).toBe(26);
  });

  it('refuses a database that already has rides', async () => {
    const tiny: DemoRoutesFile = {
      attribution: '',
      routes: [
        {
          id: 'tiny',
          name: 'Tiny',
          bikeType: 'road',
          points: [
            [41.98, 2.82, 80],
            [41.99, 2.83, 90],
          ],
        },
      ],
    };
    const ctx = await testContext();
    await seedDemo(ctx, tiny);
    await expect(seedDemo(ctx, tiny)).rejects.toThrow(/already contains 3 ride/);
  });
});
