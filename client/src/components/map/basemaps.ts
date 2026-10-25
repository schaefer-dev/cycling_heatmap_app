import type { BaseMap } from '../../App';
import type { LatLngTuple } from '../../api';

export type MapTone = 'dark' | 'light';

export interface BaseMapStyle {
  label: string;
  url: string;
  attribution: string;
  /** Dark or light map: the heat ramp is tuned per tone. */
  tone: MapTone;
  /** Separate label layer drawn above the base (Esri canvas maps). */
  labelsUrl?: string;
  /** Highest zoom the server has tiles for; Leaflet upscales beyond it. */
  maxNativeZoom?: number;
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const ESRI = `Tiles &copy; <a href="https://www.esri.com">Esri</a>, HERE, Garmin, ${OSM} contributors`;
const esri = (name: string) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}/MapServer/tile/{z}/{y}/{x}`;

export const BASE_MAPS: Record<BaseMap, BaseMapStyle> = {
  dark: {
    label: 'Dark',
    url: esri('World_Dark_Gray_Base'),
    labelsUrl: esri('World_Dark_Gray_Reference'),
    maxNativeZoom: 16,
    attribution: ESRI,
    tone: 'dark',
  },
  light: {
    label: 'Muted light',
    url: esri('World_Light_Gray_Base'),
    labelsUrl: esri('World_Light_Gray_Reference'),
    maxNativeZoom: 16,
    attribution: ESRI,
    tone: 'light',
  },
  osm: {
    label: 'Standard',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: OSM,
    tone: 'light',
  },
};

/** URL of the single tile containing `center` at `zoom`, for style previews. */
export function sampleTileUrl(style: BaseMapStyle, center: LatLngTuple, zoom = 12): string {
  const n = 2 ** zoom;
  const [lat, lng] = center;
  const latRad = (lat * Math.PI) / 180;
  const x = Math.floor(((lng + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  return style.url
    .replace('{s}', 'a')
    .replace('{z}', String(zoom))
    .replace('{x}', String(x))
    .replace('{y}', String(y))
    .replace('{r}', '');
}
