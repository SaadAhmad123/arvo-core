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
    // One database and one cluster, shared by every file. Two files that
    // reset the record store cannot be running at once, and the store
    // cannot be reset per subject either: a record may not be deleted,
    // so clearing it means TRUNCATE, which takes the whole table.
    //
    // This is a property of integration tests against real
    // infrastructure rather than something to engineer around. Within a
    // file the specs already run in order.
    fileParallelism: false,
  },
});
