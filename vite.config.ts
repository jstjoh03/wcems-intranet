import { defineConfig } from 'vite'
import { fileURLToPath, URL } from 'node:url'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  server: {
    host: true, // bind on 0.0.0.0 so a phone on the same Wi-Fi can hit http://<your-pc-ip>:5173
    port: 5173,
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      // injectManifest lets us own the service worker (src/sw.ts) so we
      // can add a `push` event handler. Workbox still injects the
      // precache manifest at build time via self.__WB_MANIFEST.
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      includeAssets: ['favicon.svg', 'wcems-patch.png'],
      manifest: {
        name: 'WCEMS Employee Portal',
        short_name: 'WCEMS Portal',
        description: 'Employee portal for Waller County EMS',
        theme_color: '#0F1A33',
        background_color: '#FAFAF7',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          { src: '/wcems-patch.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        ],
      },
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // Protocols section assets: the vendored pdfjs viewer and the
        // reference PDFs/images are fetched on demand, not precached
        // (mirrors the standalone protocols app's SW strategy).
        globIgnores: ['pdfjs/**', 'protocols/**', '**/WongBaker.png', '**/Patch - Final.png'],
      },
    }),
  ],
})
