import path from 'path';
import fs from 'fs';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    server: {
      port: Number(process.env.PORT) || Number(process.env.VITE_PORT) || 5000,
      host: '0.0.0.0',
      allowedHosts: true,
    },
    optimizeDeps: {
      include: ['@decartai/sdk'],
    },
    plugins: [
      react(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico', 'robots.txt'],
        manifest: {
          name: 'FreshFront',
          short_name: 'FreshFront',
          description: 'AI Data, Research and Content Creation Platform',
          theme_color: '#000000',
          background_color: '#000000',
          display: 'standalone',
          start_url: '/',
          icons: [
            {
              src: 'https://inrveiaulksfmzsbyzqj.supabase.co/storage/v1/object/public/images/Untitled%20design.svg',
              sizes: 'any',
              type: 'image/svg+xml',
              purpose: 'any maskable'
            }
          ]
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
          maximumFileSizeToCacheInBytes: 10 * 1024 * 1024, // 10 MB limit for large bundles
          runtimeCaching: [
            {
              urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'gstatic-fonts-cache',
                expiration: {
                  maxEntries: 10,
                  maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
                },
                cacheableResponse: {
                  statuses: [0, 200]
                }
              }
            }
          ]
        }
      })
    ],
    define: {
      'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.GEMINI_ALT_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
      'process.env.PEXELS_API_KEY': JSON.stringify(env.PEXELS_API_KEY),
      'process.env.NEXT_PUBLIC_PEXELS_API_KEY': JSON.stringify(env.NEXT_PUBLIC_PEXELS_API_KEY || env.PEXELS_API_KEY),
      'process.env.NEXT_PUBLIC_CONVERTAPI_SECRET': JSON.stringify(env.NEXT_PUBLIC_CONVERTAPI_SECRET),
      'process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN': JSON.stringify(env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN),
      'process.env.BLOB_READ_WRITE_TOKEN': JSON.stringify(env.BLOB_READ_WRITE_TOKEN)
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
        '@decartai/sdk': path.resolve(__dirname, 'node_modules/@decartai/sdk/dist/index.js'),
      },
    },
    build: {
      rollupOptions: {
        external: ['three', '@sparkjsdev/spark'],
      }
    }
  };
});
