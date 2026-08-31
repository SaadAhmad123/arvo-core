/**
 * A contract declares what a handler takes in and everything it may put out,
 * one complete interface per version. Versions are independent -- 1.1.0 is a
 * separate interface from 1.0.0, not an extension of it.
 */

import {
  ArvoContractValidationError,
  createArvoContract,
  tryCreateArvoContract,
} from 'arvo-core';
import { z } from 'zod';
import { type Chapter, heading, indent } from '../display.js';

const orders = createArvoContract({
  type: 'com_order_create',
  versions: {
    '1.0.0': {
      input: z.object({ items: z.array(z.string()) }),
      outputs: { com_order_created: z.object({ order_id: z.string() }) },
    },
    '1.1.0': {
      input: z.object({
        items: z.array(z.string()),
        shipping_tier: z.enum(['standard', 'express']),
      }),
      outputs: {
        com_order_created: z.object({
          order_id: z.string(),
          estimated_delivery: z.string(),
        }),
      },
    },
  },
});

/** What a declaration gives you back. */
const whatItHolds = (): void => {
  heading('what a contract holds');

  // uri is derived from type -- every underscore becomes a slash.
  console.log('uri:     ', orders.uri);
  console.log('versions:', Object.keys(orders.versions).join(', '));

  // Each version is standalone: it knows its own dataschema without reaching
  // back to the contract.
  const v1 = orders.versions['1.0.0'];
  const v11 = orders.versions['1.1.0'];
  console.log('1.0.0 dataschema:', v1.dataschema);
  console.log('1.1.0 dataschema:', v11.dataschema);

  // Every version carries a handler error, whatever it declares as outputs.
  console.log('handler error:   ', v1.error.type);
  console.log('declared outputs:', Object.keys(v1.outputs).join(', '));

  // Indexing a version you did not declare is a compile error:
  // orders.versions["9.9.9"];
};

/**
 * Payload types differ per version, so a value for 1.1.0 is not a value for
 * 1.0.0 and TypeScript says so.
 */
const typesPerVersion = (): void => {
  heading('types are per version');

  const v1 = orders.versions['1.0.0'];
  const v11 = orders.versions['1.1.0'];

  const forV1: z.infer<typeof v1.input> = { items: ['sku-1'] };
  const forV11: z.infer<typeof v11.input> = {
    items: ['sku-1'],
    shipping_tier: 'express',
  };
  // const wrong: z.infer<typeof v11.input> = { items: [] }; // compile error

  console.log('1.0.0 input:', JSON.stringify(forV1));
  console.log('1.1.0 input:', JSON.stringify(forV11));
};

/**
 * Two ways to declare one, and no third: `createArvoContract` throws an
 * invalid declaration, `tryCreateArvoContract` reports it. Reach for the
 * factory rather than `new ArvoContract()` -- see the conventions in the
 * sandbox README.
 *
 * There is no factory for a single version either: you read one off the
 * contract (`contract.versions["1.0.0"]`) rather than building one.
 */
const twoWaysToDeclare = (): void => {
  heading('two ways to declare one');

  const version = {
    '1.0.0': { input: z.object({ sku: z.string() }), outputs: {} },
  };

  const thrown = createArvoContract({ type: 'com_a_b', versions: version });
  console.log('createArvoContract:   ', thrown.uri);

  const reported = tryCreateArvoContract({
    type: 'com_a_b',
    versions: version,
  });
  console.log('tryCreateArvoContract:', reported.ok ? 'ok' : 'reported');

  const invalid = tryCreateArvoContract({
    type: 'Com_A_B', // must be lowercase_snake_case
    versions: version,
  });
  console.log(
    '  an invalid one:      ',
    invalid.ok
      ? 'ok'
      : `${invalid.error._tag}, ${invalid.error.issues.length} issue`,
  );
};

/** A broken declaration reports every problem at once, not the first. */
const whenItIsInvalid = (): void => {
  heading('when a declaration is broken');

  try {
    createArvoContract({
      type: 'com_order_create',
      domain: 'Bad_Domain', // must be lowercase_snake_case
      versions: {
        '01.0.0': {
          input: z.object({ a: z.string() }),
          outputs: { Bad_Key: z.object({ b: z.string() }) },
        } as any,
      } as any,
    });
  } catch (error) {
    if (!(error instanceof ArvoContractValidationError)) throw error;
    console.log(indent(error.message));
  }
};

/**
 * An invalid `type` is the exception. The uri, the handler error type and the
 * output-key collision rules are all built from it, so checking them would
 * judge values the declaration never established. It reports the type alone
 * and says the list is partial -- note there is no complaint about a uri that
 * was never supplied.
 */
const oneFaultStopsTheRest = (): void => {
  heading('the one fault that stops the rest');

  try {
    createArvoContract({
      type: 'Com_Order_Create', // must be lowercase_snake_case
      domain: 'Bad_Domain',
      versions: {
        '01.0.0': { input: z.object({ a: z.string() }), outputs: {} } as any,
      } as any,
    });
  } catch (error) {
    if (!(error instanceof ArvoContractValidationError)) throw error;
    console.log(indent(error.message));
    const [blocking] = error.issues;
    console.log(`\n  issues reported: ${error.issues.length}`);
    console.log(`  isBlocking:      ${blocking?.isBlocking}`);
  }
};

export const chapter: Chapter = {
  title: '06. Declaring contracts',
  run: () => {
    whatItHolds();
    typesPerVersion();
    twoWaysToDeclare();
    whenItIsInvalid();
    oneFaultStopsTheRest();
  },
};
