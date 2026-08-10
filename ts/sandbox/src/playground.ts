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
	ArvoEvent,
	ArvoEventSerializer,
	ArvoEventValidationError,
	ArvoSemanticVersion,
	CloudEvent,
	CloudEventConverter,
	CloudEventTransformationError,
} from "arvo-core";
import { shutdownOtel, tracer } from "./otel.js";

const section = (title: string): void =>
	console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);

/**
 * 1. Build an event.
 *
 * Only `subject`, `source`, `type`, `data`, and `dataschema` are required.
 * Everything else is defaulted or derived -- `id` gets a UUID, `time` gets
 * now, `depth` starts at 0, `executionid` falls back to `subject`.
 */
async function buildingAnEvent(): Promise<ArvoEvent> {
	section("1. Building an event");

	const span = tracer.startSpan("order.created");
	span.setAttribute("order.id", "order-42");

	const event = new ArvoEvent({
		subject: "order-42",
		source: "order-service",
		type: "order.created",
		data: { amount: 100, currency: "GBP" },
		dataschema: "#/contracts/order",
		span, // traceparent/tracestate are derived from this internally
	});

	span.end();

	console.log("id:          ", event.id);
	console.log("time:        ", event.time);
	console.log("depth:       ", event.depth);
	console.log("executionid: ", event.executionid, "(defaulted to subject)");
	console.log("traceparent: ", event.traceparent);

	// `data` is frozen -- the walk that validates it also locks it, so an
	// event cannot be mutated out from under whoever is holding it.
	try {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately breaking it
		(event.data as any).amount = 999;
	} catch (error) {
		console.log("mutating data throws:", (error as Error).message);
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
	section("2. When an event is invalid");

	try {
		new ArvoEvent({
			subject: "", // must be non-empty
			source: "order-service",
			type: "order.created",
			data: { amount: 100 },
			dataschema: "#/contracts/order",
			depth: -1, // must be a non-negative integer
			// biome-ignore lint/suspicious/noExplicitAny: deliberately wrong
			executionunits: "free" as any, // must be a number or null
		});
	} catch (error) {
		if (!(error instanceof ArvoEventValidationError)) throw error;

		console.log(error.message);
		console.log("\nthe same thing, as data:");
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
	section("3. Throwing vs Result");

	const serializer = new ArvoEventSerializer();

	const wire = await serializer.serialize(event); // throws on failure
	console.log("wire:", `${wire.slice(0, 120)}...`);

	const result = await serializer.trySerialize(event); // never throws
	console.log("result.ok:", result.ok);

	// Narrow on `ok` and TypeScript gives you `value` or `error`, never both.
	const failed = await serializer.tryDeserialize("this is not json");
	if (failed.ok) {
		console.log("unexpected success");
	} else {
		console.log("tryDeserialize failed with:", failed.error.name);
		console.log("cause:", (failed.error.cause as Error | undefined)?.name);
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
	section("4. Round trip");

	const serializer = new ArvoEventSerializer();
	const back = await serializer.deserialize(wire);

	console.log("id matches:         ", back.id === event.id);
	console.log("traceparent matches:", back.traceparent === event.traceparent);
	console.log("data matches:       ", JSON.stringify(back.data));
}

/**
 * 5. The CloudEvent boundary, directly.
 *
 * The serializer uses `CloudEventConverter` underneath, but you can reach
 * for it yourself when you want the CloudEvent object rather than a string
 * -- publishing through an SDK that already speaks CloudEvents, say.
 */
async function cloudEventsDirectly(event: ArvoEvent): Promise<void> {
	section("5. Converting to and from a CloudEvent");

	const converter = new CloudEventConverter();

	const cloudEvent = await converter.convert(event);
	// Fields CloudEvent already has (id, source, type, subject, time) map
	// straight across. Everything Arvo-specific becomes an `arvo*` extension,
	// and extensions are strings on the wire -- note depth.
	console.log("type:           ", cloudEvent.type);
	console.log(
		"subject:        ",
		cloudEvent.subject,
		"(native, not an extension)",
	);
	console.log("datacontenttype:", cloudEvent.datacontenttype);
	const arvoExtensions = Object.fromEntries(
		Object.entries(cloudEvent).filter(([key]) => key.startsWith("arvo")),
	);
	console.log("arvo extensions:", arvoExtensions);

	const back = await converter.revert(cloudEvent);
	console.log("reverted subject:", back.subject);
}

/**
 * 6. A CloudEvent that isn't ours.
 *
 * Strict reversion rejects anything not Arvo-shaped. Supply a fallback and
 * the foreign event is adapted instead: you provide what Arvo requires and
 * the source event cannot supply.
 */
async function foreignCloudEvents(): Promise<void> {
	section("6. Adapting a foreign CloudEvent");

	const converter = new CloudEventConverter();

	const foreign = new CloudEvent({
		id: "stripe-evt-1",
		// Arvo wants a URI-reference that survives normalization unchanged, so
		// "https://stripe.com" is rejected -- it normalizes to a trailing
		// slash and no longer matches what you wrote. Give it a path.
		source: "https://stripe.com/webhooks",
		type: "payment.succeeded",
		specversion: "1.0",
		data: { amount: 2000 },
	});

	// Without a fallback: rejected, and told exactly what's missing.
	const strict = await converter.tryRevert(foreign);
	if (!strict.ok) {
		console.log("strict reversion rejected it:");
		console.log(indent(strict.error.message));
	}

	// With a fallback: adapted.
	const adapted = await converter.revert(foreign, {
		dataschema: "#/contracts/payment",
		subject: "payment-1",
		to: "billing-service",
	});
	console.log("\nadapted subject:", adapted.subject);
	console.log("adapted to:     ", adapted.to);
	console.log("adapted data:   ", JSON.stringify(adapted.data));
}

/**
 * 7. Skipping the CloudEvent layer entirely.
 *
 * `arvoevent` mode writes the ArvoEvent's own JSON instead of a CloudEvent.
 * Smaller and faster, at the cost of nothing else being able to read it.
 */
async function arvoEventMode(event: ArvoEvent): Promise<void> {
	section("7. arvoevent mode");

	const cloudMode = new ArvoEventSerializer();
	const arvoMode = new ArvoEventSerializer({ type: "arvoevent" });

	const asCloudEvent = await cloudMode.serialize(event);
	const asArvoEvent = await arvoMode.serialize(event);

	console.log("cloudevent mode:", asCloudEvent.length, "bytes");
	console.log("arvoevent mode: ", asArvoEvent.length, "bytes");

	const back = await arvoMode.deserialize(asArvoEvent);
	console.log("round trips:    ", back.id === event.id);

	// Reading arvoevent-mode output with a cloudevent-mode serializer fails,
	// which is the tradeoff made explicit.
	const mismatch = await cloudMode.tryDeserialize(asArvoEvent);
	console.log("cross-mode read ok:", mismatch.ok);
	if (!mismatch.ok) {
		console.log(
			"  rejected as:",
			mismatch.error instanceof CloudEventTransformationError
				? "CloudEventTransformationError"
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
	section("8. Semantic versions");

	// Type position: only literals of the right shape are assignable.
	const pinned: ArvoSemanticVersion = "1.4.0";
	console.log("pinned:", pinned);

	// Value position: a narrowing guard, for when you just need yes or no.
	const fromConfig: unknown = process.env.CONTRACT_VERSION ?? "2.0.1";
	if (ArvoSemanticVersion.check(fromConfig)) {
		// `fromConfig` is ArvoSemanticVersion here, no cast needed.
		const [major] = fromConfig.split(".");
		console.log("check passed, major:", major);
	}

	for (const candidate of ["1.2.3", "0.0.0", "01.2.3", "1.2", "v1.2.3"]) {
		console.log(
			`  check(${JSON.stringify(candidate)}) ->`,
			ArvoSemanticVersion.check(candidate),
		);
	}

	// Result position: when the caller has to be *told* what is wrong.
	// The error names every broken rule, not just the first.
	const bad = ArvoSemanticVersion.tryCheck("01..z");
	if (!bad.ok) {
		console.log("\ntryCheck failure:");
		console.log(indent(bad.error.message));
		console.log("\nas data:");
		for (const issue of bad.error.issues) {
			console.log(`  ${issue.path}: ${issue.message}`);
		}
	}

	// A non-string is a single issue -- there are no segments to talk about.
	const notAString = ArvoSemanticVersion.tryCheck(123);
	if (!notAString.ok) {
		console.log("\nnon-string:", notAString.error.issues.length, "issue");
		console.log(indent(notAString.error.message));
	}
}

const indent = (text: string): string =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");

async function main(): Promise<void> {
	const event = await buildingAnEvent();
	whenAnEventIsInvalid();
	const wire = await throwingVersusResult(event);
	await roundTripping(event, wire);
	await cloudEventsDirectly(event);
	await foreignCloudEvents();
	await arvoEventMode(event);
	semanticVersions();
}

await main();
await shutdownOtel();
