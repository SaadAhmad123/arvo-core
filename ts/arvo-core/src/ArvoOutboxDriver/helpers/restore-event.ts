import type { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventSerializerError } from '../../serializers/ArvoEventSerializer/errors.js';
import type { ArvoEventSerializer } from '../../serializers/ArvoEventSerializer/index.js';
import type { CloudEventTransformationError } from '../../serializers/cloudevent/errors.js';
import type { AsyncResult } from '../../types.js';

/**
 * A stored payload back to the live event it holds, by ADR-003's strict,
 * Arvo-shaped reverse through `cloudEventSerializer`, or why it will not
 * restore.
 */
export const restoreEvent = (
  cloudEventSerializer: ArvoEventSerializer,
  payload: string,
): AsyncResult<
  ArvoEvent,
  CloudEventTransformationError | ArvoEventSerializerError
> =>
  // no foreign fallback: without one a CloudEvent that is not Arvo-shaped is refused, which is what keeps this strict
  cloudEventSerializer.tryDeserialize(payload);
