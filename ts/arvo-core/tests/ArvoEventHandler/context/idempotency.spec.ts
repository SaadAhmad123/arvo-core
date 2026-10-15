import { describe, expect, it } from 'vitest';
import { arvoIdempotencyKeysFor } from '../../../src/ArvoEventHandler/context/idempotency.js';

/**
 * The keys, against the composition rather than against themselves.
 *
 * Every expected value below is a literal. A spec that recomputed the
 * composition it is checking would pass whatever the composition became,
 * which is the one thing these must not do: the cost of getting this
 * wrong is an effect made twice at a third party, and nothing in a run
 * reports it.
 *
 * See `docs/adr/014-idempotency-keys.md`.
 */

/** Something to key, with nothing special about any of it. */
const PARTS = {
  subject: 'workflow-one',
  executionId: 'a'.repeat(64),
  deliveredEventId: 'event-one',
};

describe('the three idempotency keys', () => {
  it('are the strings the pinned composition produces', async () => {
    expect(await arvoIdempotencyKeysFor(PARTS)).toEqual({
      workflow:
        'arvo-workflow-1c083ff9fad5fe5682ae3fcf37c1153144c2607544a66e53e8dc145f125f2322',
      execution:
        'arvo-execution-2664a69a2f13450988a1abfb0d9115ac11dc8eb946a2b3e0eb9de2fb10d5bae3',
      delivery:
        'arvo-delivery-86b5d576ff1358a592e1ab54baeb1a430a1dd14849bcdd6cb1e748ce5e6da52e',
    });
  });

  it('name the composition, its version and the scope, then sixty-four hex characters', async () => {
    const keys = await arvoIdempotencyKeysFor(PARTS);

    for (const [scope, key] of Object.entries(keys)) {
      expect(key).toMatch(new RegExp(`^arvo-${scope}-[0-9a-f]{64}$`));
    }
  });

  it('hand back something nothing can change afterwards', async () => {
    const keys = await arvoIdempotencyKeysFor(PARTS);
    expect(Object.isFrozen(keys)).toBe(true);
  });

  // ------------------------------------------- what the composition prevents

  it('keep two scopes apart where one input equals the other', async () => {
    // A workflow whose subject is some execution's identifier. Without
    // the scope's name inside the hash these would be one key, and an
    // executor using both would find its second call treated as a
    // repeat of its first.
    const keys = await arvoIdempotencyKeysFor({
      ...PARTS,
      subject: PARTS.executionId,
    });

    expect(keys.workflow).toBe(
      'arvo-workflow-131677c65d90d5308b590e1c2116fd965d197a9fbe09a7cf777e940f2b0537d6',
    );
    expect(keys.execution).toBe(
      'arvo-execution-2664a69a2f13450988a1abfb0d9115ac11dc8eb946a2b3e0eb9de2fb10d5bae3',
    );
    // the hex differs, not merely the readable prefix
    expect(keys.workflow.slice(-64)).not.toBe(keys.execution.slice(-64));
  });

  it('keep two deliveries apart where their parts would join into one string', async () => {
    // `ab` ‖ `c` and `a` ‖ `bc` are one string without a separator.
    const joinedOneWay = await arvoIdempotencyKeysFor({
      subject: 'irrelevant',
      executionId: 'ab',
      deliveredEventId: 'c',
    });
    const joinedTheOther = await arvoIdempotencyKeysFor({
      subject: 'irrelevant',
      executionId: 'a',
      deliveredEventId: 'bc',
    });

    expect(joinedOneWay.delivery).toBe(
      'arvo-delivery-007faa92579d2fb5420a050054deec4f622ca76ea80cc73e56398a630b3246d1',
    );
    expect(joinedTheOther.delivery).toBe(
      'arvo-delivery-335ca6dc227589789f771bcf6e4cec8a9b757a3511b3af8b1ede940b562e3bb0',
    );
  });

  // --------------------------------------------- what each is constant across

  it('give one workflow key to every execution belonging to it', async () => {
    const here = await arvoIdempotencyKeysFor(PARTS);
    const elsewhere = await arvoIdempotencyKeysFor({
      ...PARTS,
      executionId: 'b'.repeat(64),
      deliveredEventId: 'event-two',
    });

    expect(elsewhere.workflow).toBe(here.workflow);
    // and nothing else about them is shared
    expect(elsewhere.execution).not.toBe(here.execution);
    expect(elsewhere.delivery).not.toBe(here.delivery);
  });

  it('give different workflow keys to different workflows', async () => {
    const one = await arvoIdempotencyKeysFor(PARTS);
    const another = await arvoIdempotencyKeysFor({
      ...PARTS,
      subject: 'workflow-two',
    });

    expect(another.workflow).not.toBe(one.workflow);
  });

  it('give one execution key to every event that execution receives', async () => {
    const opening = await arvoIdempotencyKeysFor(PARTS);
    const answering = await arvoIdempotencyKeysFor({
      ...PARTS,
      deliveredEventId: 'event-two',
    });

    expect(answering.execution).toBe(opening.execution);
    // while each event it receives has its own
    expect(answering.delivery).not.toBe(opening.delivery);
  });

  it('give the same keys again for the same parts, every time', async () => {
    // No clock, no randomness, nothing of the attempt: the same parts
    // are the same keys, which is what lets a replay not redo what it
    // already did.
    expect(await arvoIdempotencyKeysFor(PARTS)).toEqual(
      await arvoIdempotencyKeysFor(PARTS),
    );
  });
});
