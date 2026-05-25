import { defineConfig } from 'vitest/config';
import path from 'path';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    // NEXT_PUBLIC_BRAIN_LOCAL_HARNESS=true enables the Phase-0 stub auth path in
    // LoginForm tests.  This mirrors the local .env.local configuration.
    // SEC-C6-L1: the flag gates on-screen stub credentials; tests must match.
    env: {
      NEXT_PUBLIC_BRAIN_LOCAL_HARNESS: 'true',
    },
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/test/**/*.test.{ts,tsx}'],
    exclude: ['src/test/e2e/**'],
    coverage: {
      provider: 'v8',
      threshold: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/test/**',
        'src/app/**',
        'src/**/*.test.{ts,tsx}',
        'src/**/*.spec.{ts,tsx}',
        '**/*.config.*',
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@brain/lib-metrics': path.resolve(__dirname, '../../packages/lib-metrics/src/index.ts'),
      '@brain/api-gateway': path.resolve(__dirname, '../../apps/api-gateway/src/application/router.ts'),
      '@brain/core-auth': path.resolve(__dirname, '../../apps/core-service/src/domain/auth/brain-claim.ts'),
    },
    extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs'],
  },
});
