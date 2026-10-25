import { HEAT_RAMP } from '../../domain';
import type { MapTone } from './basemaps';

/** Deeper variant of the brand ramp: the pale low end would vanish on light maps. */
const LIGHT_RAMP = ['#0891b2', '#65a30d', '#ca8a04', '#ea580c', '#dc2626'] as const;

export function heatRamp(tone: MapTone): readonly string[] {
  return tone === 'dark' ? HEAT_RAMP : LIGHT_RAMP;
}

/**
 * leaflet.heat settings for the intensity slider (10..100) and map tone.
 *
 * leaflet.heat uses a pixel's density both as its opacity and as its position on the gradient.
 * Roads ridden once sit at `minOpacity`, so that is the main lever for keeping them visible, and
 * the gradient starts at `minOpacity` so they get the ramp's first colour instead of a mid tone.
 */
export function heatOptions(intensity: number, tone: MapTone) {
  const t = Math.min(Math.max(intensity, 10), 100) / 100;
  const minOpacity = 0.15 + t * 0.35;
  const ramp = heatRamp(tone);
  const span = 1 - minOpacity;
  const gradient: Record<number, string> = { 0: ramp[0]! };
  [0, 0.3, 0.55, 0.8, 1].forEach((p, i) => {
    gradient[Math.round((minOpacity + p * span) * 1000) / 1000] = ramp[i]!;
  });
  return {
    minOpacity,
    gradient,
    max: 1.5 - t * 1.2,
    pointIntensity: 0.3 + t * 0.7,
  };
}

/** Radius/blur grow with zoom so lines stay continuous (points are ~50 m apart). */
export function heatRadius(zoom: number) {
  if (zoom >= 18) return { radius: 11, blur: 10 };
  if (zoom >= 16) return { radius: 9, blur: 8 };
  if (zoom >= 14) return { radius: 7, blur: 6 };
  return { radius: 5, blur: 5 };
}
