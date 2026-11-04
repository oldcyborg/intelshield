import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

const api = process.env.VITE_API_BASE ?? '';
const devBuild = process.env.MOBILE_DEV === '1';

export default defineConfig(({ command }) => {
  // A phone build without MOBILE_DEV talks to the real backend: only over HTTPS.
  if (command === 'build' && !devBuild && process.env.MOBILE_RELEASE === '1' && !api.startsWith('https://')) {
    throw new Error('Bản phát hành cần VITE_API_BASE dạng https://');
  }
  return {
  plugins: [react()],
  server: { port: 5173 },
  build: { outDir: 'dist', target: 'es2020' },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
  };
});
