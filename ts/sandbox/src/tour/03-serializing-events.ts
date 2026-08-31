/**
 * Serializing an event, and the one choice the serializer offers: whether the
 * bytes on the wire are a CloudEvent or the ArvoEvent's own JSON.
 */

import {
	ArvoEvent,
	ArvoEventSerializer,
	CloudEventTransformationError,
} from "arvo-core";
import { type Chapter, heading } from "../display.js";
import { tracer } from "../otel.js";

const anEvent = (): ArvoEvent => {
	const span = tracer.startSpan("order.created");
	const event = new ArvoEvent({
		subject: "order-42",
		source: "order-service",
		type: "order.created",
		data: { amount: 100, currency: "GBP" },
		dataschema: "#/contracts/order",
		span,
	});
	span.end();
	return event;
};

/**
 * An event serialized and read back is the same event, trace context and all.
 * That is the property the wire format exists to guarantee.
 */
const roundTrip = async (): Promise<void> => {
	heading("a round trip");

	const serializer = new ArvoEventSerializer();
	const event = anEvent();

	const wire = await serializer.serialize(event);
	const back = await serializer.deserialize(wire);

	console.log("id matches:         ", back.id === event.id);
	console.log("traceparent matches:", back.traceparent === event.traceparent);
	console.log("data matches:       ", JSON.stringify(back.data));
};

/**
 * `arvoevent` mode writes the ArvoEvent's own JSON instead of a CloudEvent.
 * Smaller and faster, at the cost of nothing else being able to read it.
 */
const theTwoModes = async (): Promise<void> => {
	heading("cloudevent mode, arvoevent mode");

	const cloudMode = new ArvoEventSerializer();
	const arvoMode = new ArvoEventSerializer({ type: "arvoevent" });
	const event = anEvent();

	const asCloudEvent = await cloudMode.serialize(event);
	const asArvoEvent = await arvoMode.serialize(event);

	console.log("cloudevent mode:", asCloudEvent.length, "bytes");
	console.log("arvoevent mode: ", asArvoEvent.length, "bytes");
	console.log(
		"round trips:    ",
		(await arvoMode.deserialize(asArvoEvent)).id === event.id,
	);

	// Reading arvoevent-mode output with a cloudevent-mode serializer fails,
	// which is the tradeoff made explicit rather than left to be discovered.
	const mismatch = await cloudMode.tryDeserialize(asArvoEvent);
	console.log("cross-mode read: ", mismatch.ok ? "ok" : "rejected");
	if (!mismatch.ok) {
		console.log(
			"  as:           ",
			mismatch.error instanceof CloudEventTransformationError
				? "CloudEventTransformationError"
				: mismatch.error.name,
		);
	}
};

export const chapter: Chapter = {
	title: "03. Serializing events",
	run: async () => {
		await roundTrip();
		await theTwoModes();
	},
};
