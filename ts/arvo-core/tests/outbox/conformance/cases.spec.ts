import { describe, expect, it } from 'vitest';
import { arvoOutboxConformanceCases } from '../../../src/outbox/conformance/index.js';
import { runConformanceCase } from '../../../src/outbox/conformance/run-case.js';
import { brokenOutboxByCaseName } from '../inmemory/broken-outboxes.js';

/**
 * The kit is proven by breaking things: each case must fail against an
 * outbox broken in exactly the way it guards.
 */
describe('every conformance case', () => {
  it.each(
    arvoOutboxConformanceCases.map((conformanceCase) => [
      conformanceCase.name,
      conformanceCase,
    ]),
  )(
    'fails against an outbox that breaks it: %s',
    async (caseName, conformanceCase) => {
      const createBrokenOutbox = brokenOutboxByCaseName[caseName];
      expect(
        createBrokenOutbox,
        `no broken outbox for "${caseName}"`,
      ).toBeDefined();
      if (createBrokenOutbox === undefined) return;
      await expect(
        runConformanceCase(createBrokenOutbox, conformanceCase),
      ).rejects.toThrow();
    },
  );

  it('has a name of its own', () => {
    const caseNames = arvoOutboxConformanceCases.map(
      (conformanceCase) => conformanceCase.name,
    );
    expect(new Set(caseNames).size).toBe(caseNames.length);
  });

  it('leaves no broken outbox for a case that does not exist', () => {
    expect(Object.keys(brokenOutboxByCaseName).sort()).toEqual(
      arvoOutboxConformanceCases
        .map((conformanceCase) => conformanceCase.name)
        .sort(),
    );
  });
});
