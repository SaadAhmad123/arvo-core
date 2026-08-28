import { byContract } from './by-contract.js';
import { clone } from './clone.js';
import { forContract } from './for-contract.js';
import { handlerError } from './handler-error.js';
import { raw } from './raw.js';

/**
 * Builds events, reporting a failure rather than throwing.
 *
 * Call it with the event's fields, or reach a variant that reads a contract:
 *
 * ```ts
 * tryCreateArvoEvent({ type, data, source, dataschema });
 * tryCreateArvoEvent.clone(event, { to: 'com.audit.log' });
 * tryCreateArvoEvent.for(version, { source, data });
 * tryCreateArvoEvent.by(version, { type: 'com_order_created', source, data });
 * tryCreateArvoEvent.error(version, { source, error });
 * ```
 */
export const tryCreateArvoEvent = Object.freeze(
  Object.assign(raw, {
    clone,
    for: forContract,
    by: byContract,
    error: handlerError,
  }),
);
