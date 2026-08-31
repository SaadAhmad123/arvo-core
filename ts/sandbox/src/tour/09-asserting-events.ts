/**
 * Asserting an event against a contract.
 *
 * A contract answers what an event is; a version with an expected type gives
 * the payload a type. Either way the event that comes back is the event that
 * went in -- asserting reads, it does not rewrite.
 */

import {
  ArvoContractAssertionError,
  type ArvoEvent,
  createArvoContract,
  createArvoEvent,
} from 'arvo-core';
import { z } from 'zod';
import { type Chapter, heading } from '../display.js';

const orders = createArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ items: z.array(z.string()), tier: z.string() }),
      outputs: { com_order_shipped: z.object({ eta: z.string() }) },
    },
  },
});

/** An event arriving from outside, as if off a queue. */
const arriving = (
  type: string,
  data: Record<string, unknown>,
  version: keyof typeof orders.versions = '1.0.0',
): ArvoEvent =>
  createArvoEvent({
    source: 'com.playground',
    subject: 'order-42',
    type,
    dataschema: `${orders.uri}/${version}`,
    data,
  });

/**
 * Asking the contract, versus telling a version what you expect. The first
 * gives you facts; the second gives you a typed payload.
 */
const askingAndExpecting = (): void => {
  heading('asking, and expecting');

  // Facts, not types: which version, which scope, and the event.
  const asked = orders.assert(
    arriving('com_order_created', { order_id: 'o-1' }),
  );
  console.log(`  asking:    version ${asked.version}, scope ${asked.scope}`);

  // Expecting a type, straight to the version. The payload is typed.
  const v1 = orders.versions['1.0.0'];
  const expected = v1.assert(
    arriving('com_order_created', { order_id: 'o-2' }),
    'com_order_created',
  );
  console.log(
    `  expecting: order_id ${expected.event.data.order_id}, scope ${expected.scope}`,
  );

  // The event is the one that went in.
  const supplied = arriving('com_order_create', { items: ['book'] });
  console.log(`  same event back: ${v1.assert(supplied).event === supplied}`);
};

/**
 * Discovery, then typed access. The version must be narrowed to a literal
 * first: the expected-type overload is not callable on a union of version
 * contracts at all.
 */
const discoverThenNarrow = (): void => {
  heading('discover, then narrow');

  const found = orders.assert(
    arriving('com_order_shipped', { eta: 'tuesday' }, '1.1.0'),
  );
  console.log(`  found: version ${found.version}, scope ${found.scope}`);

  if (found.version === '1.1.0' && found.scope === 'output') {
    const shipped = orders.versions['1.1.0'].assert(
      found.event,
      'com_order_shipped',
    );
    console.log(`  narrowed: eta ${shipped.event.data.eta}`);
  }
};

/**
 * Each failure reports its own position, so a caller compares a field rather
 * than reading a message.
 */
const everyWayItFails = (): void => {
  heading('every way this can fail, and where it is reported');

  const v1 = orders.versions['1.0.0'];
  const bare = (type: string, dataschema: string): ArvoEvent =>
    createArvoEvent({
      source: 'com.playground',
      subject: 'order-42',
      type,
      dataschema,
      data: { items: [] },
    });

  const failures: Array<[string, () => unknown]> = [
    [
      'expecting a type the version does not declare',
      () =>
        v1.tryAssert(
          arriving('com_order_create', { items: [] }),
          'com_order_shipped' as never,
        ),
    ],
    [
      'a dataschema that is not {uri}/{version}',
      () => v1.tryAssert(bare('com_order_create', 'noseparator')),
    ],
    [
      'an event from another contract',
      () => v1.tryAssert(bare('com_order_create', '#/com/other/thing/1.0.0')),
    ],
    [
      'an event from a version this is not',
      () => v1.tryAssert(arriving('com_order_create', { items: [] }, '1.1.0')),
    ],
    [
      'a type none of the shapes declare',
      () => v1.tryAssert(arriving('com_order_cancelled', {})),
    ],
    [
      'a payload the schema rejects',
      () => v1.tryAssert(arriving('com_order_create', { items: [1] })),
    ],
  ];

  for (const [name, run] of failures) {
    const attempt = run() as {
      ok: boolean;
      error?: ArvoContractAssertionError;
    };
    const issue = attempt.error?.issues[0];
    console.log(`  ${name}\n    -> ${issue?.path}: ${issue?.message}`);
  }

  // The throwing companion carries the same failure.
  try {
    v1.assert(arriving('com_order_cancelled', {}));
  } catch (error) {
    console.log(
      `\n  throwing companion: ${error instanceof ArvoContractAssertionError}`,
    );
  }
};

export const chapter: Chapter = {
  title: '09. Asserting events against a contract',
  run: () => {
    askingAndExpecting();
    discoverThenNarrow();
    everyWayItFails();
  },
};
