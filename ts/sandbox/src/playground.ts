/**
 * A scratch pad for trying out `arvo-core` (ts) as it currently exists on
 * disk -- not the last published npm release.
 *
 * `arvo-core` is linked here via `file:../arvo-core`, so this always sees
 * whatever is currently built into `ts/arvo-core/dist/`. If you've changed
 * `ts/arvo-core/src/`, run `pnpm run build` there first (or `pnpm run dev`
 * for anything that reads `src/` directly) before your edits show up here.
 *
 * Run this file with `pnpm run play`.
 *
 * Each section below is standalone -- comment out the ones you don't care
 * about, or copy one into your own file and change it until it breaks.
 */

import {
  ArvoContract,
  ArvoContractSerializer,
  ArvoContractValidationError,
  ArvoEvent,
  ArvoEventSerializer,
  ArvoEventValidationError,
  ArvoSemanticVersion,
  CloudEvent,
  CloudEventConverter,
  CloudEventTransformationError,
} from 'arvo-core';
import { z } from 'zod';
import { shutdownOtel, tracer } from './otel.js';

const section = (title: string): void =>
  console.log(`\n${'='.repeat(70)}\n${title}\n${'='.repeat(70)}`);

/**
 * 1. Build an event.
 *
 * Only `subject`, `source`, `type`, `data`, and `dataschema` are required.
 * Everything else is defaulted or derived -- `id` gets a UUID, `time` gets
 * now, `depth` starts at 0, `executionid` falls back to `subject`.
 */
async function buildingAnEvent(): Promise<ArvoEvent> {
  section('1. Building an event');

  const span = tracer.startSpan('order.created');
  span.setAttribute('order.id', 'order-42');

  const event = new ArvoEvent({
    subject: 'order-42',
    source: 'order-service',
    type: 'order.created',
    data: { amount: 100, currency: 'GBP' },
    dataschema: '#/contracts/order',
    span, // traceparent/tracestate are derived from this internally
  });

  span.end();

  console.log('id:          ', event.id);
  console.log('time:        ', event.time);
  console.log('depth:       ', event.depth);
  console.log('executionid: ', event.executionid, '(defaulted to subject)');
  console.log('traceparent: ', event.traceparent);

  // `data` is frozen -- the walk that validates it also locks it, so an
  // event cannot be mutated out from under whoever is holding it.
  try {
    // biome-ignore lint/suspicious/noExplicitAny: deliberately breaking it
    (event.data as any).amount = 999;
  } catch (error) {
    console.log('mutating data throws:', (error as Error).message);
  }

  return event;
}

/**
 * 2. What a rejected event tells you.
 *
 * The constructor throws `ArvoEventValidationError` naming *every* broken
 * rule, not just the first. `.issues` carries the same information as data
 * if you'd rather render it yourself.
 */
function whenAnEventIsInvalid(): void {
  section('2. When an event is invalid');

  try {
    new ArvoEvent({
      subject: '', // must be non-empty
      source: 'order-service',
      type: 'order.created',
      data: { amount: 100 },
      dataschema: '#/contracts/order',
      depth: -1, // must be a non-negative integer
      // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
      executionunits: 'free' as any, // must be a number or null
    });
  } catch (error) {
    if (!(error instanceof ArvoEventValidationError)) throw error;

    console.log(error.message);
    console.log('\nthe same thing, as data:');
    for (const issue of error.issues) {
      console.log(`  path=${issue.path} message=${issue.message}`);
    }
  }
}

/**
 * 3. Throw, or return a Result -- your choice.
 *
 * Every fallible operation comes in both shapes. `serialize` throws;
 * `trySerialize` hands back `{ ok, value }` or `{ ok, error }`. Same work,
 * same errors, different control flow.
 */
async function throwingVersusResult(event: ArvoEvent): Promise<string> {
  section('3. Throwing vs Result');

  const serializer = new ArvoEventSerializer();

  const wire = await serializer.serialize(event); // throws on failure
  console.log('wire:', `${wire.slice(0, 120)}...`);

  const result = await serializer.trySerialize(event); // never throws
  console.log('result.ok:', result.ok);

  // Narrow on `ok` and TypeScript gives you `value` or `error`, never both.
  const failed = await serializer.tryDeserialize('this is not json');
  if (failed.ok) {
    console.log('unexpected success');
  } else {
    console.log('tryDeserialize failed with:', failed.error.name);
    console.log('cause:', (failed.error.cause as Error | undefined)?.name);
  }

  return wire;
}

/**
 * 4. Round trip.
 *
 * An event serialized and read back is the same event, trace context and
 * all. That's the property the wire format exists to guarantee.
 */
async function roundTripping(event: ArvoEvent, wire: string): Promise<void> {
  section('4. Round trip');

  const serializer = new ArvoEventSerializer();
  const back = await serializer.deserialize(wire);

  console.log('id matches:         ', back.id === event.id);
  console.log('traceparent matches:', back.traceparent === event.traceparent);
  console.log('data matches:       ', JSON.stringify(back.data));
}

/**
 * 5. The CloudEvent boundary, directly.
 *
 * The serializer uses `CloudEventConverter` underneath, but you can reach
 * for it yourself when you want the CloudEvent object rather than a string
 * -- publishing through an SDK that already speaks CloudEvents, say.
 */
async function cloudEventsDirectly(event: ArvoEvent): Promise<void> {
  section('5. Converting to and from a CloudEvent');

  const converter = new CloudEventConverter();

  const cloudEvent = await converter.convert(event);
  // Fields CloudEvent already has (id, source, type, subject, time) map
  // straight across. Everything Arvo-specific becomes an `arvo*` extension,
  // and extensions are strings on the wire -- note depth.
  console.log('type:           ', cloudEvent.type);
  console.log(
    'subject:        ',
    cloudEvent.subject,
    '(native, not an extension)',
  );
  console.log('datacontenttype:', cloudEvent.datacontenttype);
  const arvoExtensions = Object.fromEntries(
    Object.entries(cloudEvent).filter(([key]) => key.startsWith('arvo')),
  );
  console.log('arvo extensions:', arvoExtensions);

  const back = await converter.revert(cloudEvent);
  console.log('reverted subject:', back.subject);
}

/**
 * 6. A CloudEvent that isn't ours.
 *
 * Strict reversion rejects anything not Arvo-shaped. Supply a fallback and
 * the foreign event is adapted instead: you provide what Arvo requires and
 * the source event cannot supply.
 */
async function foreignCloudEvents(): Promise<void> {
  section('6. Adapting a foreign CloudEvent');

  const converter = new CloudEventConverter();

  const foreign = new CloudEvent({
    id: 'stripe-evt-1',
    // Arvo wants a URI-reference that survives normalization unchanged, so
    // "https://stripe.com" is rejected -- it normalizes to a trailing
    // slash and no longer matches what you wrote. Give it a path.
    source: 'https://stripe.com/webhooks',
    type: 'payment.succeeded',
    specversion: '1.0',
    data: { amount: 2000 },
  });

  // Without a fallback: rejected, and told exactly what's missing.
  const strict = await converter.tryRevert(foreign);
  if (!strict.ok) {
    console.log('strict reversion rejected it:');
    console.log(indent(strict.error.message));
  }

  // With a fallback: adapted.
  const adapted = await converter.revert(foreign, {
    dataschema: '#/contracts/payment',
    subject: 'payment-1',
    to: 'billing-service',
  });
  console.log('\nadapted subject:', adapted.subject);
  console.log('adapted to:     ', adapted.to);
  console.log('adapted data:   ', JSON.stringify(adapted.data));
}

/**
 * 7. Skipping the CloudEvent layer entirely.
 *
 * `arvoevent` mode writes the ArvoEvent's own JSON instead of a CloudEvent.
 * Smaller and faster, at the cost of nothing else being able to read it.
 */
async function arvoEventMode(event: ArvoEvent): Promise<void> {
  section('7. arvoevent mode');

  const cloudMode = new ArvoEventSerializer();
  const arvoMode = new ArvoEventSerializer({ type: 'arvoevent' });

  const asCloudEvent = await cloudMode.serialize(event);
  const asArvoEvent = await arvoMode.serialize(event);

  console.log('cloudevent mode:', asCloudEvent.length, 'bytes');
  console.log('arvoevent mode: ', asArvoEvent.length, 'bytes');

  const back = await arvoMode.deserialize(asArvoEvent);
  console.log('round trips:    ', back.id === event.id);

  // Reading arvoevent-mode output with a cloudevent-mode serializer fails,
  // which is the tradeoff made explicit.
  const mismatch = await cloudMode.tryDeserialize(asArvoEvent);
  console.log('cross-mode read ok:', mismatch.ok);
  if (!mismatch.ok) {
    console.log(
      '  rejected as:',
      mismatch.error instanceof CloudEventTransformationError
        ? 'CloudEventTransformationError'
        : mismatch.error.name,
    );
  }
}

/**
 * 8. Semantic versions.
 *
 * `ArvoSemanticVersion` is one name in two places: a type when you annotate
 * with it, a checker when you call it. One import covers both.
 *
 * The grammar is narrower than SemVer 2.0.0 -- three non-negative integers,
 * no leading zeros, no `-beta.1`, no `+build`, no `v` prefix. A version
 * identifies a contract, and there is nothing for the extra grammar to mean.
 */
function semanticVersions(): void {
  section('8. Semantic versions');

  // Type position: only literals of the right shape are assignable.
  const pinned: ArvoSemanticVersion = '1.4.0';
  console.log('pinned:', pinned);

  // Value position: a narrowing guard, for when you just need yes or no.
  const fromConfig: unknown = process.env.CONTRACT_VERSION ?? '2.0.1';
  if (ArvoSemanticVersion.check(fromConfig)) {
    // `fromConfig` is ArvoSemanticVersion here, no cast needed.
    const [major] = fromConfig.split('.');
    console.log('check passed, major:', major);
  }

  for (const candidate of ['1.2.3', '0.0.0', '01.2.3', '1.2', 'v1.2.3']) {
    console.log(
      `  check(${JSON.stringify(candidate)}) ->`,
      ArvoSemanticVersion.check(candidate),
    );
  }

  // Result position: when the caller has to be *told* what is wrong.
  // The error names every broken rule, not just the first.
  const bad = ArvoSemanticVersion.tryCheck('01..z');
  if (!bad.ok) {
    console.log('\ntryCheck failure:');
    console.log(indent(bad.error.message));
    console.log('\nas data:');
    for (const issue of bad.error.issues) {
      console.log(`  ${issue.path}: ${issue.message}`);
    }
  }

  // A non-string is a single issue -- there are no segments to talk about.
  const notAString = ArvoSemanticVersion.tryCheck(123);
  if (!notAString.ok) {
    console.log('\nnon-string:', notAString.error.issues.length, 'issue');
    console.log(indent(notAString.error.message));
  }
}

/**
 * 9. Contracts.
 *
 * A contract declares what a handler accepts and everything it may emit,
 * one complete interface per version. Versions are independent -- 1.1.0 is
 * a separate interface from 1.0.0, not an extension of it.
 */
function contracts(): void {
  section('9. Contracts');

  const contract = new ArvoContract({
    type: 'com_order_create',
    versions: {
      '1.0.0': {
        accepts: z.object({ items: z.array(z.string()) }),
        emits: { com_order_created: z.object({ order_id: z.string() }) },
      },
      '1.1.0': {
        accepts: z.object({
          items: z.array(z.string()),
          shipping_tier: z.enum(['standard', 'express']),
        }),
        emits: {
          com_order_created: z.object({
            order_id: z.string(),
            estimated_delivery: z.string(),
          }),
        },
      },
    },
  });

  // uri is derived from type -- every underscore becomes a slash.
  console.log('uri:     ', contract.uri);
  console.log('versions:', Object.keys(contract.versions).join(', '));

  // Each version is standalone: it knows its own dataschema without
  // reaching back to the contract.
  const v1 = contract.versions['1.0.0'];
  const v11 = contract.versions['1.1.0'];
  console.log('1.0.0 dataschema:', v1.dataschema);
  console.log('1.1.0 dataschema:', v11.dataschema);

  // Payload types differ per version, so this is a compile error on 1.1.0
  // and fine on 1.0.0.
  type OrderV1 = z.infer<typeof v1.accepts>;
  type OrderV11 = z.infer<typeof v11.accepts>;
  const orderV1: OrderV1 = { items: ['sku-1'] };
  const orderV11: OrderV11 = { items: ['sku-1'], shipping_tier: 'express' };
  console.log('1.0.0 accepts:', JSON.stringify(orderV1));
  console.log('1.1.0 accepts:', JSON.stringify(orderV11));

  // Indexing a version you did not declare is a compile error:
  // contract.versions["9.9.9"];

  // Every version carries a handler error, whatever its emits declares.
  console.log('handler error:  ', v1.handlerError.type);
  console.log('declared emits: ', Object.keys(v1.emits).join(', '));

  // A broken declaration reports every problem at once, not the first.
  try {
    new ArvoContract({
      type: 'com_order_create',
      domain: 'Bad_Domain', // must be lowercase_snake_case
      versions: {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
        '01.0.0': {
          accepts: z.object({ a: z.string() }),
          emits: { Bad_Key: z.object({ b: z.string() }) },
          // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
        } as any,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
      } as any,
    });
  } catch (error) {
    if (!(error instanceof ArvoContractValidationError)) throw error;
    console.log(`\n${indent(error.message)}`);
  }

  // An invalid type is the exception. The uri, the handler error type and the
  // emit-key collision rules are all built from it, so checking them would
  // judge values the declaration never established. It reports the type alone
  // and says the list is partial -- note there is no complaint about a uri
  // that was never supplied.
  try {
    new ArvoContract({
      type: 'Com_Order_Create', // must be lowercase_snake_case
      domain: 'Bad_Domain',
      versions: {
        // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
        '01.0.0': { accepts: z.object({ a: z.string() }), emits: {} } as any,
        // biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
      } as any,
    });
  } catch (error) {
    if (!(error instanceof ArvoContractValidationError)) throw error;
    console.log(`\n${indent(error.message)}`);
    const [blocking] = error.issues;
    console.log(`\n  issues reported: ${error.issues.length}`);
    console.log(`  isBlocking:      ${blocking?.isBlocking}`);
  }
}

function contractsAsJson(): void {
	console.log("\n--- a contract as portable JSON ---\n");

	const contract = new ArvoContract({
		type: "com_order_create",
		description: "Creates orders",
		versions: {
			"1.0.0": {
				accepts: z.object({ amount: z.number().min(1) }),
				emits: { com_order_created: z.object({ order_id: z.string() }) },
			},
		},
	});

	const serializer = new ArvoContractSerializer();
	const { schema, warningString } = serializer.serialize(contract);
	console.log(indent(JSON.stringify(JSON.parse(schema), null, 2)));
	console.log("\n  losses on the way out:", warningString ?? "none");

	// Read it straight back. This is the crossing another language would make.
	const { contract: back } = serializer.deserialize(schema);
	console.log("\n  read back:      ", back.uri, Object.keys(back.versions));
	console.log("  dataschema:     ", back.versions["1.0.0"].dataschema);
	console.log("  handler error:  ", back.versions["1.0.0"].handlerError.type);
	// `accepts` is a core zod schema, so parsing goes through zod's standalone
	// form rather than a method on it.
	console.log(
		"  still rejects amount 0?",
		!z.safeParse(back.versions["1.0.0"].accepts, { amount: 0 }).success,
	);

	// JSON Schema cannot carry every constraint zod can. What it cannot carry
	// is omitted rather than approximated, and always reported.
	const withADate = new ArvoContract({
		type: "com_report_run",
		versions: {
			"1.0.0": {
				accepts: z.object({ from: z.date(), label: z.string() }),
				emits: {},
			},
		},
	});
	console.log("\n  a contract carrying a Date:");
	console.log(indent(serializer.serialize(withADate).warningString ?? ""));

	// A form this implementation cannot read fails naming what stopped it,
	// rather than producing a contract that enforces less than it declares.
	const unreadable = JSON.stringify({
		uri: "#/com/a/b",
		type: "com_a_b",
		versions: {
			"1.0.0": {
				accepts: {
					$schema: "https://json-schema.org/draft/2020-12/schema",
					type: "object",
					properties: { a: { type: "string" } },
					unevaluatedProperties: false,
				},
				emits: {},
			},
		},
	});
	const attempt = serializer.tryDeserialize(unreadable);
	if (!attempt.ok) {
		console.log("\n  a form using unevaluatedProperties:");
		console.log(indent(attempt.error.message));
	}
}

/**
 * What a crossing costs, and how to find out.
 *
 * JSON Schema cannot express everything zod can. What it cannot express is
 * left out rather than approximated, and every omission is reported -- so a
 * form that enforces less than the contract did never comes back quietly.
 */
function whatACrossingCosts(): void {
  console.log("\n--- what a crossing costs ---\n");

  const serializer = new ArvoContractSerializer();

  // A Date has no JSON Schema equivalent, so the position ends up carrying
  // nothing. The contract still serializes.
  const withDate = new ArvoContract({
    type: "com_report_run",
    versions: {
      "1.0.0": {
        accepts: z.object({ from: z.date(), label: z.string().min(2) }),
        emits: {},
      },
    },
  });
  const dated = serializer.serialize(withDate);
  console.log("a Date in accepts:");
  console.log(indent(dated.warningString ?? "nothing lost"));
  console.log(
    "  the position now carries:",
    JSON.stringify(
      JSON.parse(dated.schema).versions["1.0.0"].accepts.properties.from,
    ),
  );

  // A url() check survives as documentation. Nothing may enforce an
  // annotation keyword, so the check stops working while staying readable.
  const withUrl = new ArvoContract({
    type: "com_link_check",
    versions: {
      "1.0.0": { accepts: z.object({ target: z.url() }), emits: {} },
    },
  });
  const linked = serializer.serialize(withUrl);
  console.log("\na url() check:");
  console.log(indent(linked.warningString ?? "nothing lost"));
  const { contract: linkedBack } = serializer.deserialize(linked.schema);
  console.log(
    "  original rejects 'nope'? ",
    !z.safeParse(withUrl.versions["1.0.0"].accepts, { target: "nope" }).success,
  );
  console.log(
    "  read back rejects it?    ",
    !z.safeParse(linkedBack.versions["1.0.0"].accepts, { target: "nope" })
      .success,
  );

  // An email() keeps working, because zod writes a pattern beside the
  // annotation and a pattern is enforced by everyone.
  const withEmail = new ArvoContract({
    type: "com_user_invite",
    versions: {
      "1.0.0": { accepts: z.object({ to: z.email() }), emits: {} },
    },
  });
  const mailed = serializer.serialize(withEmail);
  console.log("\nan email() check:");
  console.log("  losses:", mailed.warningString ?? "none");
  console.log(
    "  read back rejects 'nope'?",
    !z.safeParse(
      serializer.deserialize(mailed.schema).contract.versions["1.0.0"].accepts,
      { to: "nope" },
    ).success,
  );

  // Nothing lost at all: the usual case.
  const plain = new ArvoContract({
    type: "com_order_place",
    versions: {
      "1.0.0": {
        accepts: z.object({ sku: z.string(), qty: z.int().min(1) }),
        emits: {},
      },
    },
  });
  console.log("\na contract of plain data:");
  console.log("  losses:", serializer.serialize(plain).warningString ?? "none");
}

/**
 * Reading a form that came from somewhere else.
 *
 * This is the case the canonical form exists for: JSON written by hand, or by
 * another language's tooling, becoming a contract here.
 */
function readingAForeignForm(): void {
  console.log("\n--- reading a form from elsewhere ---\n");

  const serializer = new ArvoContractSerializer();
  const DIALECT = "https://json-schema.org/draft/2020-12/schema";

  // Hand-written, and deliberately terse: the optional fields are omitted
  // entirely and `uri` is left to be derived from `type`.
  const foreign = JSON.stringify({
    type: "com_payment_process",
    versions: {
      "1.0.0": {
        accepts: {
          $schema: DIALECT,
          type: "object",
          properties: {
            amount: { type: "number", exclusiveMinimum: 0 },
            currency: { type: "string", minLength: 3, maxLength: 3 },
          },
          required: ["amount", "currency"],
        },
        emits: {
          com_payment_processed: {
            $schema: DIALECT,
            type: "object",
            properties: { transaction_id: { type: "string" } },
            required: ["transaction_id"],
          },
        },
      },
    },
  });

  const { contract, warningString } = serializer.deserialize(foreign);
  console.log("uri derived from type:", contract.uri);
  console.log("description/domain:   ", contract.description, contract.domain);
  console.log("dataschema:           ", contract.versions["1.0.0"].dataschema);
  console.log("handler error:        ", contract.versions["1.0.0"].handlerError.type);
  console.log("losses:               ", warningString ?? "none");

  const accepts = contract.versions["1.0.0"].accepts;
  console.log("\nthe constraints still hold:");
  console.log("  { amount: 5, currency: 'GBP' } ->", z.safeParse(accepts, { amount: 5, currency: "GBP" }).success);
  console.log("  { amount: 0, currency: 'GBP' } ->", z.safeParse(accepts, { amount: 0, currency: "GBP" }).success);
  console.log("  { amount: 5, currency: 'GB' }  ->", z.safeParse(accepts, { amount: 5, currency: "GB" }).success);
}

/**
 * The ways reading a form can fail, and how each one tells you.
 *
 * A failure at the serializer's own boundary keeps the underlying error. A
 * failure of the contract's rules names every position. A malformed form
 * stops before the contract is reached and says so.
 */
function whenAFormIsRejected(): void {
  console.log("\n--- when a form is rejected ---\n");

  const serializer = new ArvoContractSerializer();
  const DIALECT = "https://json-schema.org/draft/2020-12/schema";
  const objectSchema = { $schema: DIALECT, type: "object", properties: {} };
  const show = (label: string, json: string): void => {
    const result = serializer.tryDeserialize(json);
    console.log(`${label}:`);
    if (result.ok) {
      console.log("  read without complaint");
      return;
    }
    console.log(indent(result.error.message));
    if (result.error.cause) console.log("  cause:", result.error.cause.name);
    console.log();
  };

  show("not JSON at all", "{ not json");

  // Several contract rules broken at once, all reported together.
  show(
    "three contract rules broken",
    JSON.stringify({
      type: "com_a_b",
      domain: "Bad_Domain",
      versions: {
        "01.0.0": { accepts: objectSchema, emits: { Bad_Key: objectSchema } },
      },
    }),
  );

  // A form-level fault stops the run: the contract's rules would report the
  // same position in different words, so the form answers first.
  show(
    "a schema position that is not an object",
    JSON.stringify({
      type: "com_a_b",
      domain: "Bad_Domain",
      versions: {
        "1.0.0": { accepts: { $schema: DIALECT, type: "string" }, emits: {} },
      },
    }),
  );

  // Legal JSON Schema this implementation cannot read. Named, never admitted
  // as a contract enforcing less than the form declares.
  show(
    "a construct the conversion refuses",
    JSON.stringify({
      type: "com_a_b",
      versions: {
        "1.0.0": {
          accepts: {
            $schema: DIALECT,
            type: "object",
            properties: { a: { type: "string" } },
            unevaluatedProperties: false,
          },
          emits: {},
        },
      },
    }),
  );
}

const indent = (text: string): string =>
  text
    .split('\n')
    .map((line) => `  ${line}`)
    .join('\n');

async function main(): Promise<void> {
  const event = await buildingAnEvent();
  whenAnEventIsInvalid();
  const wire = await throwingVersusResult(event);
  await roundTripping(event, wire);
  await cloudEventsDirectly(event);
  await foreignCloudEvents();
  await arvoEventMode(event);
  semanticVersions();
  contracts();
  contractsAsJson();
  whatACrossingCosts();
  readingAForeignForm();
  whenAFormIsRejected();
}

await main();
await shutdownOtel();
