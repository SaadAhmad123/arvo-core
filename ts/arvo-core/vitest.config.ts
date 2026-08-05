import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
    },
  },
});
