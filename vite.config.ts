import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  plugins: [
    react(),
    {
      name: 'telegram-customer-entry',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          const pathname = request.url?.split('?')[0] ?? '';
          if (
            request.method === 'GET' &&
            /^\/tg(?:\/|$)/.test(pathname) &&
            !pathname.includes('.')
          ) {
            request.url =
              '/tg/index.html' +
              (request.url?.includes('?') ? '?' + request.url.split('?').slice(1).join('?') : '');
          }
          next();
        });
      },
    },
  ],
  build: { rollupOptions: { input: { main: 'index.html', telegram: 'tg/index.html' } } },
  server: {
    strictPort: true,
    allowedHosts: ['host.docker.internal', 'web'],
    ...(process.env.VITE_USE_POLLING === 'true'
      ? {
          watch: {
            usePolling: true,
            interval: 300,
            // Native builds are unrelated to HMR; polling them across the Windows
            // bind mount can block even ordinary page/API requests.
            ignored: [
              '**/backups/**',
              '**/artifacts/**',
              '**/dist/**',
              '**/backend/**',
              '**/android-kitchen/**',
            ],
          },
        }
      : {}),
    ...(process.env.VITE_HMR_CLIENT_PORT
      ? { hmr: { clientPort: Number(process.env.VITE_HMR_CLIENT_PORT) } }
      : {}),
    fs: {
      deny: [
        '.env',
        '.env.*',
        '*.{crt,pem}',
        '**/.git/**',
        '**/.aws/**',
        '**/.codex/**',
        '**/.agents/**',
        '**/backups/**',
        '**/artifacts/**',
        '**/backend/**',
        '**/android-kitchen/**',
      ],
    },
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:8080',
        configure(proxy) {
          // Keep the private API's trusted client-IP header protected when Vite replaces nginx.
          proxy.on('proxyReq', (proxyReq, req) => {
            proxyReq.setHeader('X-Real-IP', req.socket.remoteAddress ?? '127.0.0.1');
          });
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['src/test/setup.ts'],
    include: [
      'src/app/**/*.test.{ts,tsx}',
      'src/features/**/*.test.{ts,tsx}',
      'src/shared/**/*.test.{ts,tsx}',
    ],
    restoreMocks: true,
  },
});
