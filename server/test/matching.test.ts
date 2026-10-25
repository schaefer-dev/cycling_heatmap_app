import { describe, expect, it } from 'vitest';
import { bboxOf, pathLengthM, removeSpikes, resample } from '../src/geo/geo.ts';
import { clusterRides, type RideShape } from '../src/matching/clustering.ts';
import {
  DEFAULT_MATCH_SETTINGS,
  compareTracks,
  findDeviations,
  prepareTrack,
} from '../src/matching/similarity.ts';
import type { TrackPoint } from '../src/track/codec.ts';
import {
  LOOP,
  LOOP_EXTENDED,
  LOOP_PARTIAL,
  LOOP_SHIFTED_START,
  LOOP_WITH_DETOUR,
  reversed,
  ride,
  type XY,
} from './helpers/tracks.ts';

const tol = DEFAULT_MATCH_SETTINGS.toleranceM;

function shape(id: string, points: TrackPoint[], day = 0): RideShape {
  const line = resample(removeSpikes(points), 25);
  return { id, time: day * 86_400_000, lengthM: pathLengthM(line), bbox: bboxOf(line), line };
}

function compare(a: XY[], b: XY[], seedA = 1, seedB = 2) {
  const sa = shape('a', ride(a, { noiseM: 5, seed: seedA }));
  const sb = shape('b', ride(b, { noiseM: 5, seed: seedB }));
  return compareTracks(prepareTrack(sa.line, tol), prepareTrack(sb.line, tol), tol);
}

describe('route similarity', () => {
  it('matches the same loop recorded twice with GPS noise', () => {
    const c = compare(LOOP, LOOP);
    expect(c.score).toBeGreaterThan(0.97);
    expect(c.direction).toBe('forward');
  });

  it('matches a ride with a short detour (road closure) and reports the detour', () => {
    const c = compare(LOOP_WITH_DETOUR, LOOP);
    expect(c.score).toBeGreaterThanOrEqual(DEFAULT_MATCH_SETTINGS.threshold);

    const detourRide = shape('d', ride(LOOP_WITH_DETOUR, { noiseM: 5, seed: 3 }));
    const ref = shape('r', ride(LOOP, { noiseM: 5, seed: 4 }));
    const dev = findDeviations(detourRide.line, ref.line);
    expect(dev.detours).toHaveLength(1);
    // 400 m out + 1000 m parallel + 400 m back, minus the parts within tolerance of the route.
    expect(dev.detourLengthM).toBeGreaterThan(1600);
    expect(dev.detourLengthM).toBeLessThan(2000);
    expect(dev.skipped).toHaveLength(1); // the closed 1 km of the east leg
    expect(dev.skippedLengthM).toBeGreaterThan(900);
  });

  it('does not match rides that only partially overlap', () => {
    expect(compare(LOOP_PARTIAL, LOOP).score).toBeLessThan(0.8);
  });

  it('does not match the route plus a long extension', () => {
    const c = compare(LOOP_EXTENDED, LOOP);
    expect(c.coverageBA).toBeGreaterThan(0.95); // the loop is fully inside the extended ride...
    expect(c.score).toBeLessThan(DEFAULT_MATCH_SETTINGS.threshold); // ...but not vice versa
  });

  it('matches the loop ridden in reverse and flags the direction', () => {
    const c = compare(reversed(LOOP), LOOP);
    expect(c.score).toBeGreaterThan(0.95);
    expect(c.direction).toBe('reverse');
  });

  it('matches the loop started at a different corner, still forward', () => {
    const c = compare(LOOP_SHIFTED_START, LOOP);
    expect(c.score).toBeGreaterThan(0.95);
    expect(c.direction).toBe('forward');
  });

  it('does not match an out-and-back on one leg of the loop', () => {
    const outAndBack: XY[] = [
      [0, 0],
      [6000, 0],
      [0, 0],
    ];
    expect(compare(outAndBack, LOOP).score).toBeLessThan(0.6);
  });

  it('ignores a single GPS spike', () => {
    const points = ride(LOOP, { noiseM: 3, seed: 9 });
    points[500] = { ...points[500]!, lat: points[500]!.lat + 0.01 }; // ~1.1 km jump
    const a = shape('a', points);
    const b = shape('b', ride(LOOP, { noiseM: 3, seed: 10 }));
    expect(
      compareTracks(prepareTrack(a.line, tol), prepareTrack(b.line, tol), tol).score
    ).toBeGreaterThan(0.97);
  });
});

describe('clustering', () => {
  const settings = DEFAULT_MATCH_SETTINGS;

  it('groups repeated routes, keeps different routes apart, ordered and deterministic', () => {
    const rides = [
      shape('r1', ride(LOOP, { noiseM: 5, seed: 1 }), 1),
      shape('r2', ride(LOOP_WITH_DETOUR, { noiseM: 5, seed: 2 }), 2),
      shape('r3', ride(reversed(LOOP), { noiseM: 5, seed: 3 }), 3),
      shape('r4', ride(LOOP_PARTIAL, { noiseM: 5, seed: 4 }), 4),
      shape('r5', ride(LOOP_EXTENDED, { noiseM: 5, seed: 5 }), 5),
      shape('r6', ride(LOOP_PARTIAL, { noiseM: 5, seed: 6 }), 6),
    ];
    const clusters = clusterRides(rides, settings);
    const groups = clusters.map((c) => c.members.map((m) => m.rideId).sort());
    expect(groups).toEqual([['r1', 'r2', 'r3'], ['r4', 'r6'], ['r5']]);
    expect(clusters[0]!.members.find((m) => m.rideId === 'r3')!.direction).toBe('reverse');

    // Same input in a different order gives the same result.
    expect(clusterRides([...rides].reverse(), settings)).toEqual(clusters);
  });

  it('does not let a chain of slightly shifted rides drift into one route', () => {
    // Each ride moves the western leg 30 m further west: neighbours match, the ends do not.
    const rides = Array.from({ length: 8 }, (_, i) => {
      const dx = -30 * i * 4;
      const wp: XY[] = [
        [dx, 0],
        [6000, 0],
        [6000, 4000],
        [dx, 4000],
        [dx, 0],
      ];
      return shape(`c${i}`, ride(wp, { noiseM: 2, seed: i + 1 }), i);
    });
    const clusters = clusterRides(rides, settings);
    for (const c of clusters) {
      for (const m of c.members) expect(m.score).toBeGreaterThanOrEqual(settings.threshold);
    }
    expect(clusters.length).toBeGreaterThan(1);
  });

  it('keeps manually grouped rides together even when they do not match', () => {
    const rides = [
      shape('a', ride(LOOP, { seed: 1 }), 1),
      shape('b', ride(LOOP_PARTIAL, { seed: 2 }), 2),
    ];
    const clusters = clusterRides(
      rides,
      settings,
      new Map([
        ['a', 'X'],
        ['b', 'X'],
      ])
    );
    expect(clusters).toHaveLength(1);
  });
});
