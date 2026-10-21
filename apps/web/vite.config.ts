import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

try {
  loadEnvFile(fileURLToPath(new URL('../../.env', import.meta.url)));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}

function readPort(name: string, fallback: number): number {
  const raw = process.env[name] ?? String(fallback);
  const port = Number(raw);
  if (
    !/^\d+$/.test(raw) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error(`${name} must be an integer between 1 and 65535.`);
  }
  return port;
}

const webPort = readPort('WEB_PORT', 5173);
const apiPort = readPort('PORT', 3001);

const alias = Object.fromEntries(
  [
    'api',
    'components',
    'constants',
    'features',
    'hooks',
    'styles',
    'test',
    'utils',
  ].map((name) => [
    `@${name}`,
    fileURLToPath(new URL(`./src/${name}`, import.meta.url)),
  ]),
);

export default defineConfig({
  plugins: [react()],
  resolve: { alias },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
  server: {
    port: webPort,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${apiPort}`, changeOrigin: true },
    },
  },
});
