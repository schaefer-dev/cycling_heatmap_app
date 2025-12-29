import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

export default function HeatmapLayer({ points, intensity = 50 }) {
  const map = useMap();

  useEffect(() => {
    if (!points || points.length === 0) return;

    // Intensity controls how visible low-frequency areas are
    // Higher intensity = single rides are more visible
    // We adjust both the point intensity and the max value
    const pointIntensity = 0.3 + (intensity / 100) * 0.7; // 0.3 to 1.0
    const maxValue = 1.5 - (intensity / 100) * 1.2; // 1.5 to 0.3 (lower = more sensitive)

    // Create heatmap layer
    // Points are [lat, lng] pairs with intensity value
    const heatData = points.map(([lat, lng]) => [lat, lng, pointIntensity]);

    const heatLayer = L.heatLayer(heatData, {
      radius: 15,
      blur: 20,
      maxZoom: 17,
      max: maxValue,
      gradient: {
        0.0: '#0000ff',
        0.25: '#00ffff',
        0.5: '#00ff00',
        0.75: '#ffff00',
        1.0: '#ff0000'
      }
    });

    heatLayer.addTo(map);

    // Disable pointer events on the heatmap canvas so clicks pass through to tracks
    // The canvas is created lazily, so we need to wait for it
    const disablePointerEvents = () => {
      const canvas = heatLayer._canvas;
      if (canvas) {
        canvas.style.pointerEvents = 'none';
      }
    };

    // Try immediately and also after a short delay (for lazy initialization)
    disablePointerEvents();
    setTimeout(disablePointerEvents, 100);

    // Also disable on map events that might recreate the canvas
    map.on('zoomend moveend', disablePointerEvents);

    // Cleanup
    return () => {
      map.off('zoomend moveend', disablePointerEvents);
      map.removeLayer(heatLayer);
    };
  }, [map, points, intensity]);

  return null;
}
