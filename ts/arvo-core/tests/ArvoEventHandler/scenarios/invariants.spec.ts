import { describe, expect, it } from 'vitest';
import type { ArvoEvent } from '../../../src/ArvoEvent/index.js';
import { ArvoHandlerFault } from '../../../src/ArvoEventHandler/fault/index.js';
import { deriveArvoExecutionId } from '../../../src/ArvoEventHandler/helpers/execution-id.js';
import { createArvoEventFactory } from '../../../src/factories/ArvoEventFactory/index.js';
import type { JSONObject } from '../../../src/types.js';
import type { ArvoLattice } from '../version/scenarios/lattice.js';
import { fulfilContract, fulfilV1 } from './fixture.js';
import {
  everyExecutionKeptItsVersion,
  everyExecutionRanWhatItsEventNamed,
  everyFaultCarriesWhatItMay,
  everyFaultNamesWhatWasAskedFor,
  everyIdentityWasDerived,
} from './invariants.js';

/**
 * Each invariant against a run that breaks it.
 *
 * An invariant that cannot fail is an invariant that proves nothing, and
 * a suite full of them passes for the wrong reason. Every check here is
 * shown refusing something before it is trusted to accept anything.
 */

const opening = () =>
  createArvoEventFactory(fulfilV1).createInput({
    source: 'com.web.checkout',
    subject: 'order-1',
    to: fulfilContract.type,
    data: { items: ['book'] },
  });

/** Only the parts of a lattice an invariant reads. */
const asLattice = (parts: {
  store?: Map<string, JSONObject>;
  committed?: { executionId: string; row: JSONObject }[];
  faults?: { event: ArvoEvent; fault: ArvoHandlerFault }[];
}) =>
  ({
    store: parts.store ?? new Map(),
    transcript: {
      committed: parts.committed ?? [],
      faults: parts.faults ?? [],
    },
  }) as unknown as ArvoLattice;

/** A fault shaped as one, without running anything to produce it. */
const aFault = (
  parts: Partial<ConstructorParameters<typeof ArvoHandlerFault>[0]>,
) =>
  new ArvoHandlerFault({
    faultKind: 'record_invalid',
    message: 'something',
    violations: [],
    cause: null,
    subject: 'order-1',
    executionId: 'e-1',
    eventId: 'ev-1',
    attempt: 0,
    timestamp: 0,
    retry: null,
    abandonmentEvent: null,
    abandonmentState: null,
    ...parts,
  });

describe('every execution kept its version', () => {
  it('accepts one committed under the same version throughout', () => {
    expect(() =>
      everyExecutionKeptItsVersion(
        asLattice({
          committed: [
            { executionId: 'e-1', row: { version: '1.0.0' } },
            { executionId: 'e-1', row: { version: '1.0.0' } },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('refuses one that changed version part way through', () => {
    expect(() =>
      everyExecutionKeptItsVersion(
        asLattice({
          committed: [
            { executionId: 'e-1', row: { version: '1.0.0' } },
            { executionId: 'e-1', row: { version: '1.1.0' } },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe('every execution ran what its own event named', () => {
  it('accepts a record whose version is the one its opening event named', () => {
    expect(() =>
      everyExecutionRanWhatItsEventNamed(
        asLattice({
          store: new Map([
            [
              'e-1',
              {
                executionId: 'e-1',
                version: '1.0.0',
                initEvent: { dataschema: `${fulfilContract.uri}/1.0.0` },
              } as JSONObject,
            ],
          ]),
        }),
      ),
    ).not.toThrow();
  });

  it('refuses one running a version its opening event never named', () => {
    expect(() =>
      everyExecutionRanWhatItsEventNamed(
        asLattice({
          store: new Map([
            [
              'e-1',
              {
                executionId: 'e-1',
                version: '1.1.0',
                initEvent: { dataschema: `${fulfilContract.uri}/1.0.0` },
              } as JSONObject,
            ],
          ]),
        }),
      ),
    ).toThrow();
  });
});

describe('every identity was derived', () => {
  it('accepts a record stored under what its own event derives', async () => {
    const event = opening();
    const executionId = await deriveArvoExecutionId(event);
    await expect(
      everyIdentityWasDerived(
        asLattice({
          store: new Map([
            [
              executionId,
              { executionId, initEvent: event } as unknown as JSONObject,
            ],
          ]),
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('refuses one stored under anything else', async () => {
    const event = opening();
    await expect(
      everyIdentityWasDerived(
        asLattice({
          store: new Map([
            [
              'made-up',
              {
                executionId: 'made-up',
                initEvent: event,
              } as unknown as JSONObject,
            ],
          ]),
        }),
      ),
    ).rejects.toThrow();
  });
});

describe('every fault names what was asked for', () => {
  const event = opening();

  it('accepts an unplaceable event naming no execution', () => {
    expect(() =>
      everyFaultNamesWhatWasAskedFor(
        asLattice({
          faults: [
            {
              event,
              fault: aFault({
                faultKind: 'event_unclassifiable',
                executionId: null,
              }),
            },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('refuses an unplaceable event that names one anyway', () => {
    expect(() =>
      everyFaultNamesWhatWasAskedFor(
        asLattice({
          faults: [
            {
              event,
              fault: aFault({
                faultKind: 'event_unclassifiable',
                executionId: 'from-nowhere',
              }),
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('refuses a placed event that names none', () => {
    expect(() =>
      everyFaultNamesWhatWasAskedFor(
        asLattice({
          faults: [
            {
              event,
              fault: aFault({
                faultKind: 'record_expected',
                executionId: null,
              }),
            },
          ],
        }),
      ),
    ).toThrow();
  });
});

describe('every fault carries only what it may', () => {
  const event = opening();

  it('accepts a terminal refusal carrying neither half', () => {
    expect(() =>
      everyFaultCarriesWhatItMay(
        asLattice({
          faults: [
            { event, fault: aFault({ faultKind: 'lifecycle_terminal' }) },
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('refuses one carrying an answer it may not send', () => {
    expect(() =>
      everyFaultCarriesWhatItMay(
        asLattice({
          faults: [
            {
              event,
              fault: aFault({
                faultKind: 'lifecycle_terminal',
                abandonmentEvent: 'anything',
              }),
            },
          ],
        }),
      ),
    ).toThrow();
  });

  it('refuses one carrying a record it may not write', () => {
    expect(() =>
      everyFaultCarriesWhatItMay(
        asLattice({
          faults: [
            {
              event,
              fault: aFault({
                faultKind: 'event_unclassifiable',
                abandonmentState: 'anything',
              }),
            },
          ],
        }),
      ),
    ).toThrow();
  });
});
