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
 */

import { ArvoEvent, ArvoEventSerializer } from "arvo-core";

const event = new ArvoEvent({
  subject: "order-42",
  source: "order-service",
  type: "order.created",
  data: { amount: 100 },
  dataschema: "#/contracts/order",
});

console.log("constructed:", event.id, event.subject, event.time);

const serializer = new ArvoEventSerializer();
const wire = await serializer.serialize(event);
console.log("wire:", wire);

const roundTripped = await serializer.deserialize(wire);
console.log("round-tripped id matches:", roundTripped.id === event.id);
