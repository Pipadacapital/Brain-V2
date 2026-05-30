import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/interfaces/server.ts'],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      '@brain/lib-metrics': '../../packages/lib-metrics/src/index.ts',
      '@brain/core-auth': '../../apps/core-service/src/domain/auth/brain-claim.ts',
      '@brain/core-onboarding': '../../apps/core-service/src/application/onboarding/index.ts',
      '@brain/core-connectors': '../../apps/core-service/src/application/connectors/index.ts',
      '@brain/core-notifications': '../../apps/core-service/src/application/notifications/index.ts',
      '@brain/core-user-profile': '../../apps/core-service/src/application/user-profile/index.ts',
      '@brain/core-product-cogs': '../../apps/core-service/src/application/product-cogs/index.ts',
      '@brain/core-store-browser': '../../apps/core-service/src/application/store-browser/index.ts',
      '@brain/core-platform-ads': '../../apps/core-service/src/application/platform-ads/index.ts',
      '@brain/core-settings': '../../apps/core-service/src/application/settings/index.ts',
    },
  },
});
