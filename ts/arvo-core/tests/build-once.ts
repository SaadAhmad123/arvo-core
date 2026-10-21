import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The package built, for a test that loads what a deployment loads.
 *
 * Two suites run worker threads, each in its own process, and each has
 * to find a build newer than the source. Left to themselves they would
 * both start one, and the second would rewrite `dist` under the first
 * while its threads were loading from it.
 *
 * So the build is taken under a lock on disk, which is the only thing
 * two processes that share no memory can agree on.
 */

const TESTS_DIRECTORY = new URL('.', import.meta.url).pathname;
const PACKAGE_ROOT = join(TESTS_DIRECTORY, '..');
const BUILT_INDEX = join(PACKAGE_ROOT, 'dist', 'ArvoEventHandler', 'index.js');
const SOURCE_DIRECTORY = join(PACKAGE_ROOT, 'src');
const BUILD_LOCK = join(PACKAGE_ROOT, 'node_modules', '.arvo-build-lock');

/** The compiler, named by path so nothing resolves through `PATH`. */
const COMPILER = join(PACKAGE_ROOT, 'node_modules', 'typescript', 'bin', 'tsc');

/** When anything under a directory was last written. */
const latestWriteTime = (directory: string): number => {
  let latestWrite = 0;
  for (const directoryEntry of readdirSync(directory, {
    withFileTypes: true,
  })) {
    const entryPath = join(directory, directoryEntry.name);
    const lastWritten = directoryEntry.isDirectory()
      ? latestWriteTime(entryPath)
      : statSync(entryPath).mtimeMs;
    if (lastWritten > latestWrite) latestWrite = lastWritten;
  }
  return latestWrite;
};

/** Whether what is built is older than what it was built from. */
const buildIsStale = (): boolean =>
  !existsSync(BUILT_INDEX) ||
  statSync(BUILT_INDEX).mtimeMs < latestWriteTime(SOURCE_DIRECTORY);

/** Blocks this thread, the only synchronous wait the language has. */
const pauseFor = (milliseconds: number): void => {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
};

/** Blocks until nothing else is building. */
const waitForBuildLock = (): void => {
  const deadline = Date.now() + 180_000;
  while (existsSync(BUILD_LOCK) && Date.now() < deadline) {
    pauseFor(200);
  }
};

/**
 * Builds the package where what is built is older than the source, and
 * waits where another process is already doing it.
 */
export const buildOnce = (): void => {
  if (!buildIsStale()) return;

  if (existsSync(BUILD_LOCK)) {
    waitForBuildLock();
    if (!buildIsStale()) return;
  }

  mkdirSync(BUILD_LOCK, { recursive: true });
  try {
    if (buildIsStale()) {
      execFileSync(process.execPath, [COMPILER], {
        cwd: PACKAGE_ROOT,
        stdio: 'ignore',
      });
    }
  } finally {
    rmSync(BUILD_LOCK, { recursive: true, force: true });
  }
};

/**
 * Vitest's global setup, which runs once before any file is collected.
 *
 * It has to be here rather than in a `beforeAll`: a suite that loads
 * the built package imports it as it is collected, which is before any
 * hook of its own has run.
 */
export default buildOnce;
