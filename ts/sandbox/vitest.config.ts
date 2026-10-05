import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // the stack is real, and a spec that waits on Tempo or on a
    // five-hundred-wide fan-out waits longer than a unit test ever would
    testTimeout: 120_000,
    hookTimeout: 120_000,
    // one telemetry SDK and one connection pool per file, torn down with
    // it: sharing either across files makes a leak look like a flake
    isolate: true,
  },
});
