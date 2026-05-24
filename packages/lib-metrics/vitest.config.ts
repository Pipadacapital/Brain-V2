import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.{test,spec}.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.test.ts',
        'src/**/*.spec.ts',
        // parity-runner.ts is a CLI tool invoked by check-metrics-parity.sh,
        // not a library function; exclude from coverage threshold.
        'src/parity-runner.ts',
      ],
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 70,
      },
    },
  },
})
