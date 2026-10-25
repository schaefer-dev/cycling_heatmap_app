import { describe, expect, it } from 'vitest';
import { decideGarminType } from '../src/garmin/activityTypes.ts';
import { extractFitFromZip, parseFit } from '../src/parsers/fit.ts';
import { InvalidActivityFileError, parseGpx } from '../src/parsers/gpx.ts';
import { isGenericTitle, pickTitleName, uniqueName } from '../src/matching/naming.ts';
import { buildFit, zipFit } from './helpers/fit.ts';
import { ride, toGpx } from './helpers/tracks.ts';

const gpx = (body: string, meta = '') =>
  `<?xml version="1.0"?><gpx version="1.1" creator="t">${meta}${body}</gpx>`;

describe('GPX parser', () => {
  it('parses points, title, type and keeps the order', () => {
    const points = ride([
      [0, 0],
      [500, 0],
    ]);
    const parsed = parseGpx(toGpx(points, { name: 'Evening loop', type: 'road_biking' }));
    expect(parsed.title).toBe('Evening loop');
    expect(parsed.points).toHaveLength(points.length);
    expect(parsed.points[0]!.time).toBe(points[0]!.time);
    expect(parsed).toMatchObject({ isCycling: true, detectedBikeType: 'road' });
  });

  it('reads all tracks of a file with several <trk> elements', () => {
    const trk = (lat: number) =>
      `<trk><name>T</name><trkseg><trkpt lat="${lat}" lon="9"><ele>1</ele></trkpt><trkpt lat="${lat + 0.001}" lon="9"/></trkseg></trk>`;
    expect(parseGpx(gpx(trk(47) + trk(48))).points).toHaveLength(4);
  });

  it('keeps an elevation of 0 and numeric-looking names as strings', () => {
    const parsed = parseGpx(
      gpx(
        `<trk><name>2023</name><trkseg><trkpt lat="1" lon="2"><ele>0</ele></trkpt><trkpt lat="1.001" lon="2"/></trkseg></trk>`
      )
    );
    expect(parsed.points[0]!.ele).toBe(0);
    expect(parsed.points[1]!.ele).toBeNull();
    expect(parsed.title).toBe('2023');
  });

  it('falls back to metadata time when points have no timestamps', () => {
    const parsed = parseGpx(
      gpx(
        `<trk><trkseg><trkpt lat="1" lon="2"/><trkpt lat="1.001" lon="2"/></trkseg></trk>`,
        '<metadata><time>2024-03-01T07:00:00Z</time></metadata>'
      )
    );
    expect(parsed.points[0]!.time).toBe(Date.parse('2024-03-01T07:00:00Z'));
    expect(parsed.title).toBeNull();
  });

  it('prefers <trk><type> over extensions and uses the filename as last resort', () => {
    const withExt = gpx(
      `<trk><type>mountain_biking</type><extensions><gpxx:TrackExtension><gpxx:ActivityType>road</gpxx:ActivityType></gpxx:TrackExtension></extensions><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>`
    );
    expect(parseGpx(withExt).detectedBikeType).toBe('mtb');
    const plain = gpx(`<trk><trkseg><trkpt lat="1" lon="2"/></trkseg></trk>`);
    expect(parseGpx(plain, 'my_gravel_ride.gpx').detectedBikeType).toBe('gravel');
    expect(parseGpx(plain, 'activity_123.gpx').activityType).toBe('unknown');
  });

  it('rejects files without tracks or points', () => {
    expect(() => parseGpx(gpx(''))).toThrow(InvalidActivityFileError);
    expect(() => parseGpx(gpx('<trk><trkseg></trkseg></trk>'))).toThrow(/no valid trackpoints/);
    expect(() => parseGpx('not xml <<<')).toThrow(InvalidActivityFileError);
  });
});

describe('FIT parser', () => {
  it('decodes positions, timestamps, session totals and sensors', () => {
    const points = ride([
      [0, 0],
      [1000, 0],
    ]);
    const parsed = parseFit(
      buildFit(points, { sport: 'cycling', subSport: 'road', withSensors: true })
    );
    expect(parsed.points).toHaveLength(points.length);
    expect(parsed.points[0]!.lat).toBeCloseTo(points[0]!.lat, 6);
    expect(parsed.points[0]!.lng).toBeCloseTo(points[0]!.lng, 6);
    expect(parsed.points[0]!.time).toBe(Math.floor(points[0]!.time! / 1000) * 1000);
    expect(parsed).toMatchObject({
      isCycling: true,
      detectedBikeType: 'road',
      distanceM: 12345,
      elevationGainM: 123,
    });
    expect(parsed.devices).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          manufacturer: 'quarq',
          serialNumber: 987654,
          antDeviceNumber: 4242,
        }),
      ])
    );
  });

  it('extracts the FIT file from Garmin download archives', () => {
    const fit = buildFit(
      ride([
        [0, 0],
        [100, 0],
      ])
    );
    expect(extractFitFromZip(zipFit(fit, 1))).toEqual(fit);
  });

  it('rejects non-FIT data', () => {
    expect(() => parseFit(new TextEncoder().encode('hello world, not a fit file'))).toThrow(
      InvalidActivityFileError
    );
  });
});

describe('Garmin activity types', () => {
  it.each([
    ['road_biking', 'road'],
    ['gravel_cycling', 'gravel'],
    ['mountain_biking', 'mtb'],
    ['cycling', null],
  ])('imports %s as %s', (key, bikeType) => {
    expect(decideGarminType(key)).toEqual({ action: 'import', bikeType });
  });

  it.each(['indoor_cycling', 'virtual_ride', 'walking', 'hiking', undefined])('skips %s', (key) => {
    expect(decideGarminType(key).action).toBe('skip');
  });
});

describe('route naming', () => {
  it.each([
    'Saarbrücken Rennradfahren',
    'Saarbrücken Gravel/Offroad-Radfahren',
    'Saarbrücken Mountainbiken',
    'Rehlingen-Siersburg Rennradfahren',
    'Prato allo Stelvio Rennradfahren',
    'Saarbrücken Graveln',
    'Afternoon Gravel Ride',
    'Morning Ride',
    'Rennradfahren',
    'Indoor Cycling',
    'Unnamed Ride',
    '',
    null,
  ])('treats %j as a generic title', (title) => {
    expect(isGenericTitle(title)).toBe(true);
  });

  it.each([
    '6S Ost 65k Waldtour',
    'Biotop Beeden shortcut 84k flach',
    'Bliestal Gravel',
    'Laces - Intervals 4 x 5:00',
  ])('keeps %j as a custom title', (title) => {
    expect(isGenericTitle(title)).toBe(false);
  });

  it('picks the most frequent custom title, newest on ties', () => {
    expect(
      pickTitleName([
        { title: 'Morning Ride', time: 1 },
        { title: 'Waldtour', time: 2 },
        { title: 'waldtour', time: 3 },
        { title: 'Seerunde', time: 4 },
      ])
    ).toBe('waldtour'); // same title in two spellings: the most recent spelling is shown
    expect(
      pickTitleName([
        { title: 'A', time: 1 },
        { title: 'B', time: 2 },
      ])
    ).toBe('B');
    // "#n" repeat counters are ignored; the majority spelling wins over a typo.
    expect(
      pickTitleName([
        { title: '6S 68k Gravel Ost Climbing #3', time: 1 },
        { title: '6S 68k Gravel Ost Climbing #2', time: 2 },
        { title: '6S 68k Gravel Ost Climing #1', time: 3 },
      ])
    ).toBe('6S 68k Gravel Ost Climbing');
    expect(pickTitleName([{ title: 'Saarbrücken Radfahren', time: 1 }])).toBeNull();
  });

  it('makes names unique', () => {
    const taken = new Set(['X', 'X (2)']);
    expect(uniqueName('X', (n) => taken.has(n))).toBe('X (3)');
    expect(uniqueName('Y', (n) => taken.has(n))).toBe('Y');
  });
});
