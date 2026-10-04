import { execSync } from 'node:child_process';
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

const HERE = new URL('.', import.meta.url).pathname;
const ROOT = join(HERE, '..');
const BUILT = join(ROOT, 'dist', 'ArvoEventHandler', 'index.js');
const SOURCE = join(ROOT, 'src');
const LOCK = join(ROOT, 'node_modules', '.arvo-build-lock');

/** When anything under a directory was last written. */
const newestUnder = (where: string): number => {
  let newest = 0;
  for (const entry of readdirSync(where, { withFileTypes: true })) {
    const at = join(where, entry.name);
    const when = entry.isDirectory() ? newestUnder(at) : statSync(at).mtimeMs;
    if (when > newest) newest = when;
  }
  return newest;
};

/** Whether what is built is older than what it was built from. */
const stale = (): boolean =>
  !existsSync(BUILT) || statSync(BUILT).mtimeMs < newestUnder(SOURCE);

/** Blocks until nothing else is building. */
const waitForTheOther = (): void => {
  const until = Date.now() + 180_000;
  while (existsSync(LOCK) && Date.now() < until) {
    // a busy wait, because this runs before any test and there is
    // nothing else for this process to be doing
    execSync('sleep 0.2');
  }
};

/**
 * Builds the package where what is built is older than the source, and
 * waits where another process is already doing it.
 */
export const buildOnce = (): void => {
  if (!stale()) return;

  if (existsSync(LOCK)) {
    waitForTheOther();
    if (!stale()) return;
  }

  mkdirSync(LOCK, { recursive: true });
  try {
    if (stale()) execSync('pnpm build', { cwd: ROOT, stdio: 'ignore' });
  } finally {
    rmSync(LOCK, { recursive: true, force: true });
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
