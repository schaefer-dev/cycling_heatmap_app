import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Vite only answers requests for localhost/IPs unless a host name is allowed here
    // (protection against DNS rebinding). ".ts.net" covers Tailscale MagicDNS names; add more,
    // comma-separated, with VITE_ALLOWED_HOSTS (e.g. "ridestack.home.arpa,.local").
    allowedHosts: [
      '.ts.net',
      ...(process.env.VITE_ALLOWED_HOSTS ?? '')
        .split(',')
        .map((h) => h.trim())
        .filter(Boolean),
    ],
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
