import { describe, expect, it } from 'vitest';
import { BASE_MAPS, sampleTileUrl } from '../src/components/map/basemaps';
import { downsample, elevationProfile, pointAtDistance } from '../src/components/map/elevation';
import { heatOptions, heatRamp } from '../src/components/map/heat';
import { directionArrows } from '../src/components/map/mapUtils';

describe('heatOptions', () => {
  it('keeps rarely ridden roads visible: the opacity floor grows with intensity', () => {
    const low = heatOptions(10, 'dark');
    const mid = heatOptions(50, 'dark');
    const high = heatOptions(100, 'dark');
    expect(mid.minOpacity).toBeCloseTo(0.325);
    expect(low.minOpacity).toBeLessThan(mid.minOpacity);
    expect(high.minOpacity).toBeGreaterThan(mid.minOpacity);
    expect(high.max).toBeLessThan(low.max);
  });

  it('starts the gradient at the opacity floor with the ramp for the map tone', () => {
    const { gradient, minOpacity } = heatOptions(50, 'light');
    const ramp = heatRamp('light');
    expect(gradient[Math.round(minOpacity * 1000) / 1000]).toBe(ramp[0]);
    expect(gradient[1]).toBe(ramp[4]);
    expect(heatRamp('dark')).not.toEqual(ramp);
  });
});

describe('elevation profile', () => {
  // Points ~111 m apart along a meridian.
  const track: Array<[number, number]> = [
    [49, 7],
    [49.001, 7],
    [49.002, 7],
    [49.003, 7],
  ];

  it('accumulates distance and skips points without elevation', () => {
    const profile = elevationProfile(track, [200, null, 210, 205]);
    expect(profile.map((p) => p.index)).toEqual([0, 2, 3]);
    expect(profile[1]!.distKm).toBeCloseTo(0.2226, 3);
    expect(profile[2]!.ele).toBe(205);
  });

  it('finds the nearest point by distance', () => {
    const profile = elevationProfile(track, [200, 201, 202, 203]);
    expect(pointAtDistance(profile, 0.12)?.index).toBe(1);
    expect(pointAtDistance(profile, 5)?.index).toBe(3);
    expect(pointAtDistance([], 1)).toBeNull();
  });

  it('downsamples evenly and keeps the ends', () => {
    const pts = Array.from({ length: 1000 }, (_, i) => i);
    const out = downsample(pts, 10);
    expect(out).toHaveLength(10);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(999);
    expect(downsample([1, 2], 10)).toEqual([1, 2]);
  });
});

describe('sampleTileUrl', () => {
  it('builds the tile URL containing a point', () => {
    expect(sampleTileUrl(BASE_MAPS.osm, [41.98, 2.82], 13)).toBe(
      'https://a.tile.openstreetmap.org/13/4160/3041.png'
    );
    expect(sampleTileUrl(BASE_MAPS.dark, [41.98, 2.82], 13)).toMatch(/\/tile\/13\/3041\/4160$/);
  });
});

describe('directionArrows', () => {
  it('spaces arrows evenly along the line, pointing the way it was ridden', () => {
    // North for 1 km, then east for 1 km (at ~42°N, 0.009° lat ≈ 1 km, 0.0121° lng ≈ 1 km).
    const track: Array<[number, number]> = [
      [42, 3],
      [42.009, 3],
      [42.009, 3.0121],
    ];
    const arrows = directionArrows(track, 3);
    expect(arrows).toHaveLength(3);
    expect(arrows[0]!.bearingDeg).toBeCloseTo(0, 0);
    expect(arrows[0]!.position[0]).toBeCloseTo(42.0045, 3);
    expect(arrows[1]!.position[0]).toBeCloseTo(42.009, 3);
    expect(arrows[2]!.bearingDeg).toBeCloseTo(90, 0);
    expect(arrows[2]!.position[1]).toBeCloseTo(3.006, 3);

    const back = directionArrows([...track].reverse(), 1);
    expect(back[0]!.bearingDeg).toBeGreaterThan(179);
  });

  it('returns nothing for degenerate lines', () => {
    expect(directionArrows([], 3)).toEqual([]);
    expect(directionArrows([[42, 3]], 3)).toEqual([]);
    expect(
      directionArrows(
        [
          [42, 3],
          [42, 3],
        ],
        3
      )
    ).toEqual([]);
  });
});
