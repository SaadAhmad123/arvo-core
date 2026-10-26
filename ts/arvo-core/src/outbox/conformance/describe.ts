import { describe, it } from 'vitest';
import { arvoOutboxConformanceCases } from './cases/index.js';
import type { ArvoOutboxConformanceParam } from './types.js';

/**
 * Registers every conformance case as a vitest test against your outbox.
 *
 * Call it at the top level of a test file. It registers one suite, with one
 * test per rule named for that rule, then one per case in
 * `param.additionalCases`, and calls `param.createOutbox` once per
 * test as that test starts. A failing test names the rule your outbox
 * breaks.
 *
 * @param param - Where the outboxes come from. See {@link ArvoOutboxConformanceParam}.
 *
 * @example
 * ```typescript
 * // postgres-outbox.spec.ts
 * import { describeArvoOutboxConformance } from 'arvo-core/outbox/conformance';
 *
 * describeArvoOutboxConformance({
 *   createOutbox: async () => PostgresOutbox.open(await createEmptySchema()),
 * });
 * ```
 */
export const describeArvoOutboxConformance = (
  param: ArvoOutboxConformanceParam,
): void => {
  describe('IArvoOutbox conformance', () => {
    for (const conformanceCase of [
      ...arvoOutboxConformanceCases,
      ...(param.additionalCases ?? []),
    ]) {
      it(conformanceCase.name, async () => {
        const outbox = await param.createOutbox();
        await conformanceCase.check(outbox);
      });
    }
  });
};
