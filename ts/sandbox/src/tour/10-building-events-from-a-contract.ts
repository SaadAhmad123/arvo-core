/**
 * The factory holds one version of a contract, so it supplies each event's
 * type, dataschema and payload rules and the caller never repeats them.
 */

import {
	type ArvoEventValidationError,
	createArvoContract,
	createArvoEventFactory,
	tryCreateArvoEventFactory,
} from "arvo-core";
import { z } from "zod";
import { type Chapter, heading } from "../display.js";

const orders = createArvoContract({
	type: "com_order_create",
	domain: "orders",
	versions: {
		"1.0.0": {
			input: z.object({
				items: z.array(z.string()),
				currency: z.string().default("GBP"),
			}),
			outputs: { com_order_created: z.object({ order_id: z.string() }) },
		},
	},
});

/** Bind the version once, and it stops being an argument at every call site. */
const binding = (): void => {
	heading("binding a version");

	const factory = createArvoEventFactory(orders.versions["1.0.0"]);
	console.log("  bound to:", factory.contract.dataschema);

	// The `try` twin exists for a caller without types, which is the only way
	// something that is not a version of a contract can reach it.
	const reported = tryCreateArvoEventFactory(orders.versions["1.0.0"]);
	console.log("  tryCreateArvoEventFactory:", reported.ok ? "ok" : "reported");
};

/** The three kinds of event a version describes, one method each. */
const theThreeKinds = (): void => {
	heading("the three kinds of event a version describes");

	const factory = createArvoEventFactory(orders.versions["1.0.0"]);

	// What the version takes in. Type, dataschema and recipient come from the
	// contract; the schema's default arrives filled in.
	const requested = factory.createInput({
		source: "com.web.checkout",
		subject: "order-42",
		data: { items: ["book"] },
	});
	console.log(`  input:  ${requested.type} -> ${requested.to}`);
	console.log(`    dataschema ${requested.dataschema}`);
	console.log(`    data       ${JSON.stringify(requested.data)}`);

	// One it puts out. Only a declared output key compiles, and no recipient is
	// invented -- where an output goes is the caller's to say.
	const produced = factory.createOutput({
		type: "com_order_created",
		source: "com.order.service",
		subject: requested.subject,
		parentid: requested.id,
		data: { order_id: "o-1" },
	});
	console.log(`  output: ${produced.type} -> ${produced.to}`);

	// Its handler error, composed from the error itself.
	try {
		throw new Error("the payment gateway timed out");
	} catch (caught) {
		const failed = factory.createError({
			source: "com.order.service",
			subject: requested.subject,
			error: caught as Error,
		});
		console.log(`  error:  ${failed.type}`);
		console.log(`    message  ${failed.data.error_message}`);
	}
};

/** Each method has a `try` twin, reporting rather than throwing. */
const whatACallerGetsWrong = (): void => {
	heading("what a caller gets wrong, and where it is reported");

	const factory = createArvoEventFactory(orders.versions["1.0.0"]);

	const failures: Array<[string, () => unknown]> = [
		[
			"a payload the schema rejects",
			() => factory.tryCreateInput({ source: "s", data: { items: [42] } as never }),
		],
		[
			"an output type the version does not declare",
			() =>
				factory.tryCreateOutput({
					type: "com_order_refunded" as "com_order_created",
					source: "s",
					data: {} as never,
				}),
		],
		[
			"something that is not an error",
			() =>
				factory.tryCreateError({ source: "s", error: null as unknown as Error }),
		],
	];

	for (const [named, run] of failures) {
		const attempt = run() as
			| { ok: true }
			| { ok: false; error: ArvoEventValidationError };
		if (attempt.ok) continue;
		for (const issue of attempt.error.issues) {
			console.log(`  ${named}\n    -> ${issue.path}: ${issue.message}`);
		}
	}
};

export const chapter: Chapter = {
	title: "10. Building events from a contract",
	run: () => {
		binding();
		theThreeKinds();
		whatACallerGetsWrong();
	},
};
