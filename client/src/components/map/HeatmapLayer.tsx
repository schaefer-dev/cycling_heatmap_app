import L from 'leaflet';
import 'leaflet.heat';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { LatLngTuple } from '../../api';

const GRADIENT = {
  0.0: '#0000ff',
  0.25: '#00ffff',
  0.5: '#00ff00',
  0.75: '#ffff00',
  1.0: '#ff0000',
};

/** Radius/blur grow with zoom so lines stay continuous (points are ~50 m apart). */
function paramsForZoom(zoom: number) {
  if (zoom >= 18) return { radius: 12, blur: 15 };
  if (zoom >= 16) return { radius: 10, blur: 12 };
  if (zoom >= 14) return { radius: 8, blur: 10 };
  return { radius: 6, blur: 8 };
}

interface Props {
  points: LatLngTuple[];
  /** 10..100: higher makes rarely ridden roads more visible. */
  intensity: number;
  opacity: number;
}

/**
 * leaflet.heat wrapper. The layer is created once; data, options and opacity are updated in
 * place instead of rebuilding the layer (and re-mapping all points) on every change.
 */
export default function HeatmapLayer({ points, intensity, opacity }: Props) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const pointIntensity = 0.3 + (intensity / 100) * 0.7;
  const maxValue = 1.5 - (intensity / 100) * 1.2;

  useEffect(() => {
    const layer = L.heatLayer([], {
      maxZoom: 18,
      gradient: GRADIENT,
      ...paramsForZoom(map.getZoom()),
    });
    layer.addTo(map);
    layer._canvas?.classList.add('leaflet-heatmap-layer');
    layerRef.current = layer;
    const onZoom = () => layer.setOptions(paramsForZoom(map.getZoom()));
    map.on('zoomend', onZoom);
    return () => {
      map.off('zoomend', onZoom);
      // leaflet.heat redraws on the next animation frame and crashes if the layer is gone by then.
      if (layer._frame) L.Util.cancelAnimFrame(layer._frame);
      map.removeLayer(layer);
      layerRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    layerRef.current?.setLatLngs(points.map(([lat, lng]) => [lat, lng, pointIntensity]));
  }, [points, pointIntensity]);

  useEffect(() => {
    layerRef.current?.setOptions({ max: maxValue });
  }, [maxValue]);

  useEffect(() => {
    const canvas = layerRef.current?._canvas;
    if (canvas) L.DomUtil.setOpacity(canvas, opacity);
  }, [opacity]);

  return null;
}
