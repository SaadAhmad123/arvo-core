/**
 * The case the canonical form exists for: JSON written by hand, or by another
 * language's tooling, becoming a contract here -- and every way that can fail.
 */

import { ArvoContractSerializer } from 'arvo-core';
import { z } from 'zod';
import { type Chapter, heading, indent } from '../display.js';

const serializer = new ArvoContractSerializer();
const DIALECT = 'https://json-schema.org/draft/2020-12/schema';

/**
 * Hand-written, and deliberately terse: the optional fields are omitted
 * entirely and `uri` is left to be derived from `type`.
 */
const readingOne = (): void => {
  heading('reading a form from elsewhere');

  const foreign = JSON.stringify({
    type: 'com_payment_process',
    versions: {
      '1.0.0': {
        input: {
          $schema: DIALECT,
          type: 'object',
          properties: {
            amount: { type: 'number', exclusiveMinimum: 0 },
            currency: { type: 'string', minLength: 3, maxLength: 3 },
          },
          required: ['amount', 'currency'],
        },
        outputs: {
          com_payment_processed: {
            $schema: DIALECT,
            type: 'object',
            properties: { transaction_id: { type: 'string' } },
            required: ['transaction_id'],
          },
        },
      },
    },
  });

  const { contract, warningString } = serializer.deserialize(foreign);
  console.log('uri derived from type:', contract.uri);
  console.log('description/domain:   ', contract.description, contract.domain);
  console.log('dataschema:           ', contract.versions['1.0.0'].dataschema);
  console.log('handler error:        ', contract.versions['1.0.0'].error.type);
  console.log('losses:               ', warningString ?? 'none');

  const input = contract.versions['1.0.0'].input;
  console.log('\nthe constraints still hold:');
  console.log(
    "  { amount: 5, currency: 'GBP' } ->",
    z.safeParse(input, { amount: 5, currency: 'GBP' }).success,
  );
  console.log(
    "  { amount: 0, currency: 'GBP' } ->",
    z.safeParse(input, { amount: 0, currency: 'GBP' }).success,
  );
  console.log(
    "  { amount: 5, currency: 'GB' }  ->",
    z.safeParse(input, { amount: 5, currency: 'GB' }).success,
  );
};

/**
 * A failure at the serializer's own boundary keeps the underlying error. A
 * failure of the contract's rules names every position. A malformed form stops
 * before the contract is reached and says so.
 */
const theWaysItFails = (): void => {
  heading('when a form is rejected');

  const objectSchema = { $schema: DIALECT, type: 'object', properties: {} };
  const show = (label: string, json: string): void => {
    const result = serializer.tryDeserialize(json);
    console.log(`${label}:`);
    if (result.ok) {
      console.log('  read without complaint');
      return;
    }
    console.log(indent(result.error.message));
    if (result.error.cause) console.log('  cause:', result.error.cause.name);
    console.log();
  };

  show('not JSON at all', '{ not json');

  // Several contract rules broken at once, all reported together.
  show(
    'three contract rules broken',
    JSON.stringify({
      type: 'com_a_b',
      domain: 'Bad_Domain',
      versions: {
        '01.0.0': { input: objectSchema, outputs: { Bad_Key: objectSchema } },
      },
    }),
  );

  // A form-level fault stops the run: the contract's rules would report the
  // same position in different words, so the form answers first.
  show(
    'a schema position that is not an object',
    JSON.stringify({
      type: 'com_a_b',
      domain: 'Bad_Domain',
      versions: {
        '1.0.0': { input: { $schema: DIALECT, type: 'string' }, outputs: {} },
      },
    }),
  );

  // Legal JSON Schema this implementation cannot read. Named, never admitted
  // as a contract enforcing less than the form declares.
  show(
    'a construct the conversion refuses',
    JSON.stringify({
      type: 'com_a_b',
      versions: {
        '1.0.0': {
          input: {
            $schema: DIALECT,
            type: 'object',
            properties: { a: { type: 'string' } },
            unevaluatedProperties: false,
          },
          outputs: {},
        },
      },
    }),
  );
};

export const chapter: Chapter = {
  title: '08. Reading a form from elsewhere',
  run: () => {
    readingOne();
    theWaysItFails();
  },
};
