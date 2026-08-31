/**
 * A domain routes an event somewhere other than the default path. It can be
 * absent, a literal, or read from a named source at build time -- the four
 * `ArvoDomain` symbols say where to read it from rather than what it is.
 */

import {
	ArvoDomain,
	createArvoContract,
	createArvoEvent,
	createArvoEventFactory,
} from "arvo-core";
import { z } from "zod";
import { type Chapter, heading } from "../display.js";

const orders = createArvoContract({
	type: "com_order_create",
	domain: "orders",
	versions: {
		"1.0.0": { input: z.object({ items: z.array(z.string()) }), outputs: {} },
	},
});

const factory = createArvoEventFactory(orders.versions["1.0.0"]);

/** An event carrying a domain of its own, so a symbol has something to read. */
const triggeringEvent = createArvoEvent({
	type: "com_order_create",
	source: "com.inbound",
	dataschema: "#/com/order/create/1.0.0",
	data: {},
	domain: "inbound_traffic",
});

const whereADomainComesFrom = (): void => {
	heading("where a domain comes from");

	const resolved: Array<[string, string | null]> = [
		[
			"omitted",
			factory.createInput({ source: "s", data: { items: [] } }).domain,
		],
		[
			"a literal",
			factory.createInput({
				source: "s",
				data: { items: [] },
				domain: "orders_priority",
			}).domain,
		],
		[
			"ArvoDomain.LOCAL",
			factory.createInput({
				source: "s",
				data: { items: [] },
				domain: ArvoDomain.LOCAL,
			}).domain,
		],
		[
			"FROM_EVENT_CONTRACT",
			factory.createInput({
				source: "s",
				data: { items: [] },
				domain: ArvoDomain.FROM_EVENT_CONTRACT,
			}).domain,
		],
		[
			"FROM_TRIGGERING_EVENT",
			factory.createInput(
				{
					source: "s",
					data: { items: [] },
					domain: ArvoDomain.FROM_TRIGGERING_EVENT,
				},
				{ domainCtx: { triggeringEvent } },
			).domain,
		],
		[
			// A symbol whose source is missing resolves to nothing, rather than
			// failing -- the event simply carries no domain.
			"FROM_TRIGGERING_EVENT, none supplied",
			factory.createInput({
				source: "s",
				data: { items: [] },
				domain: ArvoDomain.FROM_TRIGGERING_EVENT,
			}).domain,
		],
	];

	for (const [named, value] of resolved) {
		console.log(`  ${named.padEnd(36)} ${value ?? "(none)"}`);
	}
};

export const chapter: Chapter = {
	title: "11. Domains",
	run: () => {
		whereADomainComesFrom();
	},
};
