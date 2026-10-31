import type { Attributes, Span } from '@opentelemetry/api';
import { recording } from '../../ArvoEventHandler/context/telemetry/recording.js';
import type {
  ArvoOutboxCapacity,
  ArvoOutboxCapacityRequest,
} from '../../ArvoOutbox/types/capacity.js';
import type { Result } from '../../types.js';
import type { ArvoOutboxDriverError } from '../errors.js';

/**
 * Records the capacity question a commit asked on the commit's own span:
 * what was asked, and the status answered or the kind it failed with.
 */
export const recordCapacityQuestion = (
  span: Span,
  capacityRequest: ArvoOutboxCapacityRequest,
  capacityResult: Result<ArvoOutboxCapacity, ArvoOutboxDriverError>,
): void => {
  const attributes: Attributes = {
    'capacity.request.events': capacityRequest.events,
    ...(capacityRequest.state === undefined
      ? {}
      : { 'capacity.request.cas_version': capacityRequest.state.casVersion }),
    ...(capacityResult.ok
      ? { 'capacity.status': capacityResult.value.status }
      : { 'capacity.failure': capacityResult.error.kind }),
  };
  recording(() => span.addEvent('outbox_driver.capacity', attributes));
};
