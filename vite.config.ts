import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Baby Monitor',
        short_name: 'Baby Monitor',
        description: 'One-tap log for diapers, feeds, sleep and medicine',
        theme_color: '#f5f7fb',
        background_color: '#f5f7fb',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        scope: '/',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
        // Workbox's production mode runs Terser on the service worker. On the current Node 26 that
        // Terser hook never resolves, so `vite build` hangs after bundling. Development mode skips
        // minifying only the service worker. The app bundle itself stays minified.
        mode: 'development',
      },
    }),
  ],
});
