// Shared ESLint flat-config base for Brain TypeScript (backend). Consumers scope
// it to their files via typescript-eslint's `extends` (see the repo-root
// eslint.config.js). Pragmatic baseline: real-bug rules stay ERROR; stylistic /
// explicit-any are WARN so the gate is green on the existing backend while still
// surfacing them — ratchet to error over time.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

/** @type {import('eslint').Linter.Config[]} — spread or `extends:` this. */
export default [
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // WARN (visible, non-blocking) — noisy on the existing code; ratchet later.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // ERROR (blocking) — genuine bug smells.
      'no-debugger': 'error',
      'no-cond-assign': 'error',
      'no-constant-condition': ['error', { checkLoops: false }],
      'no-unsafe-negation': 'error',
      '@typescript-eslint/no-floating-promises': 'off', // needs type-info; off for speed
      '@typescript-eslint/no-misused-new': 'error',
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
    },
  },
];
