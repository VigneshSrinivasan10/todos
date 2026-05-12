import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

export default defineConfig({
  // Served from https://vigneshsrinivasan10.github.io/todos/
  base: '/todos/',
  plugins: [
    react(),
    nodePolyfills({
      include: ['events', 'process', 'buffer', 'util', 'stream'],
      globals: { process: true, Buffer: true, global: true }
    }),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Todos',
        short_name: 'Todos',
        description: 'Local-first to-dos with optional CouchDB sync',
        theme_color: '#0a0a0a',
        background_color: '#fafaf7',
        display: 'standalone',
        scope: '/todos/',
        start_url: '/todos/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}']
      }
    })
  ]
});
