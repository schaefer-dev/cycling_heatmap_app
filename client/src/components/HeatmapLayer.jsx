import { useEffect } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

export default function HeatmapLayer({ points }) {
  const map = useMap();

  useEffect(() => {
    if (!points || points.length === 0) return;

    // Create heatmap layer
    // Points are [lat, lng] pairs, we add intensity of 1.0
    const heatData = points.map(([lat, lng]) => [lat, lng, 0.5]);

    const heatLayer = L.heatLayer(heatData, {
      radius: 15,
      blur: 20,
      maxZoom: 17,
      max: 1.0,
      gradient: {
        0.0: '#0000ff',
        0.25: '#00ffff',
        0.5: '#00ff00',
        0.75: '#ffff00',
        1.0: '#ff0000'
      }
    });

    heatLayer.addTo(map);

    // Cleanup
    return () => {
      map.removeLayer(heatLayer);
    };
  }, [map, points]);

  return null;
}
