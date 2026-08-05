import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { CloudEvent, ForeignCloudEventFallback } from './types.js';

/**
 * A CloudEvent-to-CloudEvent enrichment stage a consumer appends to a
 * `CloudEventConverter`. Both directions are mandatory — there is no way to
 * construct a one-way stage — so a chain of stages always has a reverse,
 * even though nothing here can guarantee that a consumer's own
 * `convert`/`revert` pair is itself lossless.
 */
export interface ICloudEventConverter {
  convert(data: CloudEvent): Promise<CloudEvent>;
  revert(data: CloudEvent): Promise<CloudEvent>;
}

/**
 * The base ArvoEvent-to-CloudEvent stage's own contract — not an
 * instantiation of {@link ICloudEventConverter}, since `revert` takes a
 * second parameter no CloudEvent-to-CloudEvent stage has any use for. A
 * consumer replacing the base stage is typed against this directly, so
 * whether their `revert` participates in foreign-adaptation fallback is a
 * real, checked part of its signature rather than an unchecked cast.
 */
export interface IArvoEventTransformer {
  convert(data: ArvoEvent): Promise<CloudEvent>;
  revert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent>;
}
