/**
 * Seeded chance, shared by everything here that misbehaves on purpose.
 *
 * Its own module because the two users sit on opposite sides of a
 * boundary: the lattice loads the package from `src`, the threaded
 * broker loads what was built into `dist`, and neither may import the
 * other. This imports nothing, so both can have it.
 */

/** A sequence of draws in `[0, 1)`, the same every time for one seed. */
export const chanceFrom = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let bits = Math.imul(state ^ (state >>> 15), 1 | state);
    bits = (bits + Math.imul(bits ^ (bits >>> 7), 61 | bits)) ^ bits;
    return ((bits ^ (bits >>> 14)) >>> 0) / 4294967296;
  };
};
