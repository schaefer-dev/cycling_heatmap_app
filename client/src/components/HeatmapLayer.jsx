import { useEffect, useState, useCallback } from 'react';
import { useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';

// Calculate radius and blur based on zoom level
// With full track points we have dense data, radius ensures smooth trails
function getHeatmapParams(zoom) {
  if (zoom >= 18) {
    return { radius: 12, blur: 15 };
  } else if (zoom >= 16) {
    return { radius: 10, blur: 12 };
  } else if (zoom >= 14) {
    return { radius: 8, blur: 10 };
  } else {
    // Zoom 13 and below - smaller for overview
    return { radius: 6, blur: 8 };
  }
}

export default function HeatmapLayer({ points, intensity = 50, opacity = 0.8 }) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  // Track zoom changes
  const handleZoom = useCallback(() => {
    setZoom(map.getZoom());
  }, [map]);

  useEffect(() => {
    map.on('zoomend', handleZoom);
    return () => {
      map.off('zoomend', handleZoom);
    };
  }, [map, handleZoom]);

  useEffect(() => {
    if (!points || points.length === 0) return;

    // Intensity controls how visible low-frequency areas are
    // Higher intensity = single rides are more visible
    // We adjust both the point intensity and the max value
    const pointIntensity = 0.3 + (intensity / 100) * 0.7; // 0.3 to 1.0
    const maxValue = 1.5 - (intensity / 100) * 1.2; // 1.5 to 0.3 (lower = more sensitive)

    // Get zoom-appropriate radius and blur
    const { radius, blur } = getHeatmapParams(zoom);

    // Create heatmap layer
    // Points are [lat, lng] pairs with intensity value
    const heatData = points.map(([lat, lng]) => [lat, lng, pointIntensity]);

    const heatLayer = L.heatLayer(heatData, {
      radius,
      blur,
      maxZoom: 18,
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

    // Style the heatmap canvas and apply opacity
    // The canvas is created lazily, so we need to wait for it
    const styleCanvas = () => {
      const canvas = heatLayer._canvas;
      if (canvas) {
        // Allow pointer events so clicks can be detected by map click handler
        canvas.style.pointerEvents = 'auto';
        canvas.style.opacity = opacity;
      }
    };

    // Try immediately and also after a short delay (for lazy initialization)
    styleCanvas();
    setTimeout(styleCanvas, 100);

    // Also style on map events that might recreate the canvas
    map.on('zoomend moveend', styleCanvas);

    // Cleanup
    return () => {
      map.off('zoomend moveend', styleCanvas);
      map.removeLayer(heatLayer);
    };
  }, [map, points, intensity, opacity, zoom]);

  return null;
}
