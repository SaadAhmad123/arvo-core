/**
 * An event is the only thing in Arvo that moves. Everything else -- contracts,
 * factories, serializers -- exists to say what a valid one is, build one, or
 * carry one somewhere.
 */

import { ArvoEventValidationError, createArvoEvent } from "arvo-core";
import { type Chapter, heading, indent } from "../display.js";
import { tracer } from "../otel.js";

/**
 * Five fields are required: `subject`, `source`, `type`, `data` and
 * `dataschema`. Everything else is defaulted or derived.
 */
const buildingOne = (): void => {
	heading("building one");

	const span = tracer.startSpan("order.created");
	span.setAttribute("order.id", "order-42");

	const event = createArvoEvent({
		subject: "order-42",
		source: "order-service",
		type: "order.created",
		data: { amount: 100, currency: "GBP" },
		dataschema: "#/contracts/order",
		span, // traceparent/tracestate are derived from this internally
	});

	span.end();

	console.log("id:          ", event.id, "(a UUID, if you did not supply one)");
	console.log("time:        ", event.time, "(now)");
	console.log("depth:       ", event.depth, "(starts at 0)");
	console.log("executionid: ", event.executionid, "(falls back to subject)");
	console.log("traceparent: ", event.traceparent, "(read off the span)");
};

/**
 * `data` is frozen. The walk that validates it also locks it, so an event
 * cannot be mutated out from under whoever is holding it.
 */
const immutability = (): void => {
	heading("an event does not change");

	const event = createArvoEvent({
		subject: "order-42",
		source: "order-service",
		type: "order.created",
		data: { amount: 100 },
		dataschema: "#/contracts/order",
	});

	try {
		// biome-ignore lint/suspicious/noExplicitAny: deliberately breaking it
		(event.data as any).amount = 999;
	} catch (error) {
		console.log("mutating data throws:", (error as Error).message);
	}
};

/**
 * `createArvoEvent` names *every* broken rule, not just the first one it hits.
 * `.issues` carries the same information as data, for rendering it yourself.
 */
const whenItIsInvalid = (): void => {
	heading("when it is invalid");

	try {
		createArvoEvent({
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

		console.log(indent(error.message));
		console.log("\nthe same thing, as data:");
		for (const issue of error.issues) {
			console.log(`  path=${issue.path} message=${issue.message}`);
		}
	}
};

export const chapter: Chapter = {
	title: "01. Events",
	run: () => {
		buildingOne();
		immutability();
		whenItIsInvalid();
	},
};
