import { describe, expect, it, vi } from 'vitest';
import type { IArvoOutbox } from '../../../src/ArvoOutbox/interface.js';
import { describeArvoOutboxConformance } from '../../../src/outbox/conformance/describe.js';
import type { ArvoOutboxConformanceCase } from '../../../src/outbox/conformance/types.js';

/** An outbox that answers nothing, so only which one a case was given is under test. */
class StubOutbox implements IArvoOutbox {
  readLatestState() {
    return null;
  }
  commitStateAndEvents() {
    return { committed: true as const };
  }
  commitEvents() {}
  readCommittedEvents() {
    return [];
  }
  listUnseenEvents() {
    return [];
  }
  markEventsSeen() {}
}

/** One case's run: which case, under which test name, given which outbox. */
type CheckRun = {
  caseName: string;
  testName: string | undefined;
  outbox: IArvoOutbox;
};

const recorded = vi.hoisted(() => {
  const checksRun: CheckRun[] = [];
  return { checksRun };
});

vi.mock('../../../src/outbox/conformance/cases/index.js', () => ({
  arvoOutboxConformanceCases: [
    'the first stub rule',
    'the second stub rule',
  ].map(
    (caseName): ArvoOutboxConformanceCase => ({
      name: caseName,
      check: async (outbox) => {
        recorded.checksRun.push({
          caseName,
          testName: expect.getState().currentTestName,
          outbox,
        });
      },
    }),
  ),
}));

/** Builds stub outboxes after a wait, keeping each one it built. */
const createStubOutboxInto = (outboxesCreated: StubOutbox[]) => async () => {
  await Promise.resolve();
  const outbox = new StubOutbox();
  outboxesCreated.push(outbox);
  return outbox;
};

/** The runs of the cases that were given one of these outboxes, in order. */
const checksRunAgainst = (outboxesCreated: readonly StubOutbox[]) =>
  recorded.checksRun.filter((checkRun) =>
    outboxesCreated.some((outbox) => outbox === checkRun.outbox),
  );

const outboxesCreated: StubOutbox[] = [];
describeArvoOutboxConformance({
  createOutbox: createStubOutboxInto(outboxesCreated),
});
const outboxesCreatedAtRegistration = outboxesCreated.length;

const outboxesCreatedWithAdditionalCases: StubOutbox[] = [];
describeArvoOutboxConformance({
  createOutbox: createStubOutboxInto(outboxesCreatedWithAdditionalCases),
  additionalCases: [
    {
      name: 'a rule of my own',
      check: async (outbox) => {
        recorded.checksRun.push({
          caseName: 'a rule of my own',
          testName: expect.getState().currentTestName,
          outbox,
        });
      },
    },
  ],
});

describe('running the conformance kit', () => {
  it('registers one test per case, named for the case, under one suite', () => {
    expect(
      checksRunAgainst(outboxesCreated).map((checkRun) => checkRun.testName),
    ).toEqual([
      'IArvoOutbox conformance > the first stub rule',
      'IArvoOutbox conformance > the second stub rule',
    ]);
  });

  it('asks for no outbox until a case runs', () => {
    expect(outboxesCreatedAtRegistration).toBe(0);
  });

  it('asks for a new outbox for every case', () => {
    expect(outboxesCreated).toHaveLength(2);
    expect(outboxesCreated[0]).not.toBe(outboxesCreated[1]);
  });

  it('hands each case the outbox it was given, once awaited', () => {
    checksRunAgainst(outboxesCreated).forEach((checkRun, position) => {
      expect(checkRun.outbox).toBe(outboxesCreated[position]);
    });
  });

  it('runs additional cases after its own, in the same suite, each with a new outbox', () => {
    expect(
      checksRunAgainst(outboxesCreatedWithAdditionalCases).map(
        (checkRun) => checkRun.testName,
      ),
    ).toEqual([
      'IArvoOutbox conformance > the first stub rule',
      'IArvoOutbox conformance > the second stub rule',
      'IArvoOutbox conformance > a rule of my own',
    ]);
    expect(new Set(outboxesCreatedWithAdditionalCases).size).toBe(3);
  });
});
