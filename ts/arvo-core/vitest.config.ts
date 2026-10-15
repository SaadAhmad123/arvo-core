import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // a suite running worker threads loads the built package as it is
    // collected, so the build has to exist before any file is read
    globalSetup: ['tests/build-once.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      // `json` explicitly: the machine-readable report is what a
      // coverage check reads, and it is not among the defaults.
      reporter: ['text', 'json'],
      // Only what ships. `dist` is the same code compiled, and counting
      // it twice halves every figure.
      include: ['src/**'],
      exclude: ['src-v3/**'],
    },
  },
});
