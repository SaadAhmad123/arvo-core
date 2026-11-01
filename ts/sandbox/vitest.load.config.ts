import { defineConfig } from 'vitest/config';

/**
 * The load suite, run only inside its containers by `pnpm load:*`.
 *
 * One file at a time, so one check's load never skews another's numbers,
 * and with timeouts measured in what a load check takes rather than a
 * unit test.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/load/**/*.load.ts'],
    testTimeout: 30 * 60 * 1000,
    hookTimeout: 5 * 60 * 1000,
    fileParallelism: false,
    isolate: true,
  },
});
