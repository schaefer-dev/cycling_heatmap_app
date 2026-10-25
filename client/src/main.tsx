import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Leaflet's stylesheet first, so the app's overrides in index.css win.
import 'leaflet/dist/leaflet.css';
import '@fontsource-variable/overpass';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
