// Repo-root ESLint flat config (P1-16). Scopes the shared eslint-config base to
// the BACKEND TypeScript surface (api-gateway + core-service). web/mobile have
// their own framework linting (Next/Expo) and are excluded here.
import base from './packages/eslint-config/index.js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/_gen/**',
      '**/gen/**',
      '**/*.d.ts',
      '**/*.config.{js,ts,mjs,cjs}',
      '**/vitest.config.ts',
    ],
  },
  {
    files: ['apps/api-gateway/src/**/*.ts', 'apps/core-service/src/**/*.ts'],
    extends: base,
  },
);
