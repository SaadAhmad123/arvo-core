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
    },
  },
});
