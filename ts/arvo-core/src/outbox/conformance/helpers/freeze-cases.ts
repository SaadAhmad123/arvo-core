import type { ArvoOutboxConformanceCase } from '../types.js';

/** A list of conformance cases that cannot change: the list frozen, and each case in it. */
export const freezeCases = (
  conformanceCases: readonly ArvoOutboxConformanceCase[],
): readonly ArvoOutboxConformanceCase[] =>
  Object.freeze(
    conformanceCases.map((conformanceCase) => Object.freeze(conformanceCase)),
  );
