import { CloudEvent as CloudEventClass } from 'cloudevents';
import type { FlatMap } from '../../types.js';

export type { CloudEventV1 } from 'cloudevents';

/**
 * `cloudevents`' own `CloudEvent` class, re-exported directly rather than
 * hand-written: constructing one is how this module delegates
 * CloudEvents-conformance checking to a conformant implementation instead
 * of reimplementing it.
 *
 * Re-exported as both a value (the constructor) and a type fixed to a JSON
 * object `data` — every CloudEvent this module produces or consumes carries
 * the `data` wrapper object, never `undefined`, which is the class's own
 * default type parameter.
 */
export const CloudEvent = CloudEventClass;
export type CloudEvent = CloudEventClass<Record<string, unknown>>;

/**
 * Which reverse-mapping case, or which pipeline direction, a
 * {@link CloudEventTransformationError} was produced by.
 */
export type CloudEventTransformationKind = 'strict' | 'foreign' | 'stage';

/**
 * Values a caller supplies alongside a foreign CloudEvent for ArvoEvent
 * fields the foreign mapping cannot recover.
 *
 * `dataschema` is required — it is never inherited from the foreign
 * CloudEvent's own `dataschema`, which describes a different schema. Every
 * other field here only fills a gap: a value the foreign CloudEvent itself
 * carries always wins over the corresponding fallback.
 */
export type ForeignCloudEventFallback = {
  dataschema: string;
  subject?: string;
  data?: Record<string, any>;
  parentid?: string;
  initid?: string;
  executionid?: string;
  category?: string;
  depth?: number;
  to?: string;
  domain?: string;
  baggage?: FlatMap;
  time?: string;
  executionunits?: number;
};
