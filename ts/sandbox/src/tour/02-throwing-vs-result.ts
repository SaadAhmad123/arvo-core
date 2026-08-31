/**
 * Every fallible operation in `arvo-core` comes in two shapes: one that
 * throws, and a `try`-prefixed twin that hands back a `Result`. Same work,
 * same errors, different control flow -- so the caller picks, not the library.
 */

import {
	ArvoEventSerializer,
	ArvoSemanticVersion,
	type ArvoEvent,
	createArvoEvent,
} from "arvo-core";
import { type Chapter, heading, indent } from "../display.js";

const anEvent = (): ArvoEvent =>
	createArvoEvent({
		subject: "order-42",
		source: "order-service",
		type: "order.created",
		data: { amount: 100, currency: "GBP" },
		dataschema: "#/contracts/order",
	});

/** `serialize` throws; `trySerialize` returns `{ ok, value }` or `{ ok, error }`. */
const theTwoShapes = async (): Promise<void> => {
	heading("the same work, two shapes");

	const serializer = new ArvoEventSerializer();
	const event = anEvent();

	const wire = await serializer.serialize(event); // throws on failure
	console.log("serialize:   ", `${wire.slice(0, 60)}...`);

	const result = await serializer.trySerialize(event); // never throws
	console.log("trySerialize:", `ok=${result.ok}`);
};

/**
 * Narrowing on `ok` gives you `value` or `error`, never both. There is no
 * shape where you can read a value that was never produced.
 */
const narrowing = async (): Promise<void> => {
	heading("narrowing on ok");

	const serializer = new ArvoEventSerializer();
	const failed = await serializer.tryDeserialize("this is not json");

	if (failed.ok) {
		console.log("value:", failed.value.id);
	} else {
		console.log("error:", failed.error.name);
		console.log("cause:", (failed.error.cause as Error | undefined)?.name);
	}
};

/**
 * A `try` twin never throws for the failure it is about -- and the error it
 * reports carries every broken rule, not a summary.
 */
const whatTheErrorCarries = (): void => {
	heading("what the error carries");

	const bad = ArvoSemanticVersion.tryCheck("01..z");
	if (bad.ok) return;

	console.log(indent(bad.error.message));
	console.log("\nas data:");
	for (const issue of bad.error.issues) {
		console.log(`  ${issue.path}: ${issue.message}`);
	}
};

export const chapter: Chapter = {
	title: "02. Throwing vs Result",
	run: async () => {
		await theTwoShapes();
		await narrowing();
		whatTheErrorCarries();
	},
};
