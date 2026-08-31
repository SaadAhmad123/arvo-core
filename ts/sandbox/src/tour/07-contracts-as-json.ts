/**
 * A contract as portable JSON. This is the crossing another language makes:
 * the canonical form is what a Python or Go implementation reads, so what
 * survives the crossing and what does not is worth seeing directly.
 */

import { ArvoContractSerializer, createArvoContract } from "arvo-core";
import { z } from "zod";
import { type Chapter, heading, indent } from "../display.js";

const serializer = new ArvoContractSerializer();

/** Out to JSON and straight back in. */
const theRoundTrip = (): void => {
	heading("a contract as JSON");

	const contract = createArvoContract({
		type: "com_order_create",
		description: "Creates orders",
		versions: {
			"1.0.0": {
				input: z.object({ amount: z.number().min(1) }),
				outputs: { com_order_created: z.object({ order_id: z.string() }) },
			},
		},
	});

	const { schema, warningString } = serializer.serialize(contract);
	console.log(indent(JSON.stringify(JSON.parse(schema), null, 2)));
	console.log("\n  losses on the way out:", warningString ?? "none");

	const { contract: back } = serializer.deserialize(schema);
	console.log("\n  read back:    ", back.uri, Object.keys(back.versions));
	console.log("  dataschema:   ", back.versions["1.0.0"].dataschema);
	console.log("  handler error:", back.versions["1.0.0"].error.type);
	// `input` is a core zod schema, so parsing goes through zod's standalone
	// form rather than a method on it.
	console.log(
		"  still rejects amount 0?",
		!z.safeParse(back.versions["1.0.0"].input, { amount: 0 }).success,
	);
};

/**
 * JSON Schema cannot express everything zod can. What it cannot express is
 * left out rather than approximated, and every omission is reported -- so a
 * form that enforces less than the contract did never comes back quietly.
 */
const whatACrossingCosts = (): void => {
	heading("what a crossing costs");

	// A Date has no JSON Schema equivalent, so the position ends up carrying
	// nothing. The contract still serializes.
	const withDate = createArvoContract({
		type: "com_report_run",
		versions: {
			"1.0.0": {
				input: z.object({ from: z.date(), label: z.string().min(2) }),
				outputs: {},
			},
		},
	});
	const dated = serializer.serialize(withDate);
	console.log("a Date in input:");
	console.log(indent(dated.warningString ?? "nothing lost"));
	console.log(
		"  the position now carries:",
		JSON.stringify(
			JSON.parse(dated.schema).versions["1.0.0"].input.properties.from,
		),
	);

	// A url() check survives as documentation. Nothing may enforce an
	// annotation keyword, so the check stops working while staying readable.
	const withUrl = createArvoContract({
		type: "com_link_check",
		versions: {
			"1.0.0": { input: z.object({ target: z.url() }), outputs: {} },
		},
	});
	const linked = serializer.serialize(withUrl);
	console.log("\na url() check:");
	console.log(indent(linked.warningString ?? "nothing lost"));
	const { contract: linkedBack } = serializer.deserialize(linked.schema);
	console.log(
		"  original rejects 'nope'? ",
		!z.safeParse(withUrl.versions["1.0.0"].input, { target: "nope" }).success,
	);
	console.log(
		"  read back rejects it?    ",
		!z.safeParse(linkedBack.versions["1.0.0"].input, { target: "nope" }).success,
	);

	// An email() keeps working, because zod writes a pattern beside the
	// annotation and a pattern is enforced by everyone.
	const withEmail = createArvoContract({
		type: "com_user_invite",
		versions: {
			"1.0.0": { input: z.object({ to: z.email() }), outputs: {} },
		},
	});
	const mailed = serializer.serialize(withEmail);
	console.log("\nan email() check:");
	console.log("  losses:", mailed.warningString ?? "none");
	console.log(
		"  read back rejects 'nope'?",
		!z.safeParse(
			serializer.deserialize(mailed.schema).contract.versions["1.0.0"].input,
			{ to: "nope" },
		).success,
	);

	// Nothing lost at all: the usual case.
	const plain = createArvoContract({
		type: "com_order_place",
		versions: {
			"1.0.0": {
				input: z.object({ sku: z.string(), qty: z.int().min(1) }),
				outputs: {},
			},
		},
	});
	console.log("\na contract of plain data:");
	console.log("  losses:", serializer.serialize(plain).warningString ?? "none");
};

export const chapter: Chapter = {
	title: "07. Contracts as portable JSON",
	run: () => {
		theRoundTrip();
		whatACrossingCosts();
	},
};
