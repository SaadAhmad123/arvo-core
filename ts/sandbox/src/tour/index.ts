/**
 * The tour, in reading order. Each chapter is standalone -- it builds whatever
 * it needs, so you can read one on its own or copy it into your own file.
 *
 * Roughly: events, then how the package reports failure, then getting events
 * on and off a wire, then contracts, then the two things a contract does
 * (judge an event, build one).
 */

import type { Chapter } from "../display.js";
import { chapter as events } from "./01-events.js";
import { chapter as throwingVsResult } from "./02-throwing-vs-result.js";
import { chapter as serializingEvents } from "./03-serializing-events.js";
import { chapter as cloudEvents } from "./04-cloudevents.js";
import { chapter as semanticVersions } from "./05-semantic-versions.js";
import { chapter as declaringContracts } from "./06-declaring-contracts.js";
import { chapter as contractsAsJson } from "./07-contracts-as-json.js";
import { chapter as foreignForms } from "./08-reading-a-foreign-form.js";
import { chapter as assertingEvents } from "./09-asserting-events.js";
import { chapter as buildingFromAContract } from "./10-building-events-from-a-contract.js";
import { chapter as domains } from "./11-domains.js";
import { chapter as clones } from "./12-standalone-events-and-clones.js";

export const chapters: readonly Chapter[] = [
	events,
	throwingVsResult,
	serializingEvents,
	cloudEvents,
	semanticVersions,
	declaringContracts,
	contractsAsJson,
	foreignForms,
	assertingEvents,
	buildingFromAContract,
	domains,
	clones,
];
