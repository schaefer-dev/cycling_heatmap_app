import { XMLParser } from 'fast-xml-parser';
import type { TrackPoint } from '../track/codec.ts';
import { classifyActivityType, typeHintFromFilename } from './activityType.ts';
import type { ParsedActivity } from './parsedActivity.ts';

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseTagValue: false, // keep <name>2023</name> a string; numbers are parsed explicitly below
  isArray: (name) => name === 'trk' || name === 'trkseg' || name === 'trkpt',
});

type Node = Record<string, unknown>;

export class InvalidActivityFileError extends Error {}

export function parseGpx(content: string, filename = ''): ParsedActivity {
  let doc: Node;
  try {
    doc = xml.parse(content) as Node;
  } catch (e) {
    throw new InvalidActivityFileError(`Invalid GPX file: ${(e as Error).message}`);
  }
  const gpx = doc.gpx as Node | undefined;
  const tracks = (gpx?.trk as Node[] | undefined) ?? [];
  if (!gpx || tracks.length === 0)
    throw new InvalidActivityFileError('Invalid GPX file: no track found');

  const points: TrackPoint[] = [];
  for (const trk of tracks) {
    for (const seg of (trk.trkseg as Node[] | undefined) ?? []) {
      for (const pt of (seg?.trkpt as Node[] | undefined) ?? []) {
        const lat = Number.parseFloat(String(pt['@_lat']));
        const lng = Number.parseFloat(String(pt['@_lon']));
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        const ele =
          pt.ele === undefined || pt.ele === '' ? Number.NaN : Number.parseFloat(String(pt.ele));
        const time = typeof pt.time === 'string' ? Date.parse(pt.time) : Number.NaN;
        points.push({
          lat,
          lng,
          ele: Number.isFinite(ele) ? ele : null,
          time: Number.isFinite(time) ? time : null,
        });
      }
    }
  }
  if (points.length === 0)
    throw new InvalidActivityFileError('Invalid GPX file: no valid trackpoints found');

  // Without per-point timestamps, fall back to the file's metadata time for the start.
  if (points[0]!.time === null) {
    const metaTime = (gpx.metadata as Node | undefined)?.time;
    const t = typeof metaTime === 'string' ? Date.parse(metaTime) : Number.NaN;
    if (Number.isFinite(t)) points[0]!.time = t;
  }

  const first = tracks[0]!;
  const title = first.name === undefined || first.name === '' ? null : String(first.name).trim();
  return { title, points, ...classifyActivityType(detectTypeHint(gpx, first, filename)) };
}

/** Priority: <trk><type>, Garmin extension, metadata type/keywords, filename. */
function detectTypeHint(gpx: Node, trk: Node, filename: string): string | null {
  if (typeof trk.type === 'string' && trk.type.trim()) return trk.type;
  const ext = (trk.extensions ?? gpx.extensions) as Node | undefined;
  if (ext) {
    const garmin = (ext['gpxx:TrackExtension'] ?? ext['TrackExtension'] ?? ext) as Node;
    const t = garmin['gpxx:ActivityType'] ?? garmin['ActivityType'] ?? garmin['type'];
    if (typeof t === 'string' && t.trim()) return t;
  }
  const meta = gpx.metadata as Node | undefined;
  if (typeof meta?.type === 'string' && meta.type.trim()) return meta.type;
  if (typeof meta?.keywords === 'string' && classifyActivityType(meta.keywords).isCycling) {
    return meta.keywords;
  }
  return filename ? typeHintFromFilename(filename) : null;
}
