import L from 'leaflet';
import 'leaflet.heat';
import { useEffect, useRef } from 'react';
import { useMap } from 'react-leaflet';
import type { LatLngTuple } from '../../api';
import type { MapTone } from './basemaps';
import { heatOptions, heatRadius } from './heat';

interface Props {
  points: LatLngTuple[];
  /** 10..100: higher makes rarely ridden roads more visible. */
  intensity: number;
  opacity: number;
  tone: MapTone;
}

/**
 * leaflet.heat wrapper. The layer is created once; data, options and opacity are updated in
 * place instead of rebuilding the layer (and re-mapping all points) on every change.
 */
export default function HeatmapLayer({ points, intensity, opacity, tone }: Props) {
  const map = useMap();
  const layerRef = useRef<L.HeatLayer | null>(null);
  const { pointIntensity, max, minOpacity, gradient } = heatOptions(intensity, tone);

  useEffect(() => {
    const layer = L.heatLayer([], { maxZoom: 18, ...heatRadius(map.getZoom()) });
    layer.addTo(map);
    layer._canvas?.classList.add('leaflet-heatmap-layer');
    layerRef.current = layer;
    const onZoom = () => layer.setOptions(heatRadius(map.getZoom()));
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

  // The gradient object is rebuilt every render; its inputs are what matter.
  const gradientKey = JSON.stringify(gradient);
  useEffect(() => {
    layerRef.current?.setOptions({ max, minOpacity, gradient: JSON.parse(gradientKey) });
  }, [max, minOpacity, gradientKey]);

  useEffect(() => {
    const canvas = layerRef.current?._canvas;
    if (canvas) L.DomUtil.setOpacity(canvas, opacity);
  }, [opacity]);

  return null;
}
