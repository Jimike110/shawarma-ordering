import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  server: {
    strictPort: true,
    allowedHosts: ['host.docker.internal', 'web'],
    ...(process.env.VITE_USE_POLLING === 'true'
      ? {
          watch: {
            usePolling: true,
            interval: 300,
            ignored: ['**/backups/**', '**/artifacts/**', '**/dist/**', '**/backend/**'],
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
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
});
