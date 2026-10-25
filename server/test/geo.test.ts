import { describe, expect, it } from 'vitest';
import { cellNeighbourhood, cellOf } from '../src/geo/cells.ts';
import {
  elevationGainM,
  haversineM,
  pathLengthM,
  removeSpikes,
  resample,
  simplify,
} from '../src/geo/geo.ts';
import {
  decodePolyline,
  decodeTrack,
  encodePolyline,
  encodeTrack,
  type TrackPoint,
} from '../src/track/codec.ts';
import { ride, toLatLng } from './helpers/tracks.ts';

describe('geo', () => {
  it('computes haversine distances', () => {
    // One degree of latitude is ~111.2 km.
    expect(haversineM(0, 0, 1, 0)).toBeCloseTo(111_195, -1);
    expect(haversineM(47, 9, 47, 9)).toBe(0);
  });

  it('resamples to uniform spacing along the path and keeps the ends', () => {
    const straight = [toLatLng([0, 0]), toLatLng([300, 0]), toLatLng([1000, 0])];
    const out = resample(straight, 25);
    expect(out).toHaveLength(41);
    // The last interval is the remainder (the helper's 1000 m are 998.9 m by haversine).
    for (let i = 1; i < out.length - 1; i++) {
      expect(haversineM(out[i - 1]!.lat, out[i - 1]!.lng, out[i]!.lat, out[i]!.lng)).toBeCloseTo(
        25,
        1
      );
    }
    expect(out.at(-1)).toEqual(straight.at(-1));

    // Around a corner the spacing is measured along the path (1500 m → 61 points).
    expect(
      resample([toLatLng([0, 0]), toLatLng([1000, 0]), toLatLng([1000, 500])], 25)
    ).toHaveLength(61);
  });

  it('simplifies a straight line to its end points without recursion limits', () => {
    const straight = Array.from({ length: 200_000 }, (_, i) => toLatLng([i * 0.5, 0]));
    expect(simplify(straight, 5)).toHaveLength(2);
  });

  it('keeps corners when simplifying', () => {
    const points = ride([
      [0, 0],
      [1000, 0],
      [1000, 1000],
    ]);
    const s = simplify(points, 5);
    expect(s.length).toBe(3);
  });

  it('removes single-point spikes but keeps real turns', () => {
    const points = ride([
      [0, 0],
      [2000, 0],
    ]);
    const spiked = [...points];
    spiked[100] = { ...spiked[100]!, lat: spiked[100]!.lat + 0.005 };
    expect(removeSpikes(spiked)).toHaveLength(points.length - 1);
    expect(pathLengthM(removeSpikes(spiked))).toBeCloseTo(pathLengthM(points), -1);
    const turn = ride([
      [0, 0],
      [1000, 0],
      [1000, 1000],
    ]);
    expect(removeSpikes(turn)).toHaveLength(turn.length);
  });

  it('counts elevation gain with hysteresis', () => {
    expect(elevationGainM([100, 101, 100, 101, 100, 101])).toBe(0); // noise
    expect(elevationGainM([100, 110, 105, 120])).toBe(25);
    expect(elevationGainM([null, 0, 10, null, 20])).toBe(20); // 0 m is a valid elevation
  });

  it('packs grid cells so neighbours differ by fixed offsets', () => {
    const c = cellOf(47.5, 9.5);
    const n = cellNeighbourhood(47.5, 9.5);
    expect(n).toHaveLength(9);
    expect(n).toContain(c);
    expect(cellOf(-33.9, -70.6)).toBeGreaterThan(0);
  });
});

describe('track codec', () => {
  it('round-trips points including missing elevation/time and zero elevation', () => {
    const t0 = Date.UTC(2024, 4, 1, 6, 30);
    const points: TrackPoint[] = [
      { lat: 47.1234567, lng: 9.7654321, ele: 0, time: t0 },
      { lat: -33.5, lng: -70.25, ele: null, time: t0 + 1500 },
      { lat: 0, lng: 0, ele: 1234.5, time: null },
    ];
    const enc = encodeTrack(points);
    expect(enc.blob.length).toBe(points.length * 16);
    expect(decodeTrack(enc.blob, enc.t0)).toEqual(points);
  });

  it('handles tracks without any timestamps', () => {
    const enc = encodeTrack([{ lat: 1, lng: 2, ele: 3, time: null }]);
    expect(enc.t0).toBeNull();
    expect(decodeTrack(enc.blob, enc.t0)[0]!.time).toBeNull();
  });

  it('round-trips polylines at 1e-7 precision', () => {
    const line = [toLatLng([0, 0]), toLatLng([123.4, 567.8])];
    const out = decodePolyline(encodePolyline(line));
    out.forEach((p, i) => {
      expect(p.lat).toBeCloseTo(line[i]!.lat, 7);
      expect(p.lng).toBeCloseTo(line[i]!.lng, 7);
    });
  });
});
