import { randomUUID } from 'node:crypto';

/**
 * A few characters no other call returns, for a subject or a run marker
 * that must not collide with one from another test or another run.
 *
 * @param length - How many characters, at most 32.
 */
export const uniqueSuffix = (length: number): string =>
  randomUUID().replaceAll('-', '').slice(0, length);
