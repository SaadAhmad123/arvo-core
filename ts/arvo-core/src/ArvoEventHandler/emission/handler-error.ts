import type { VersionedArvoContract } from '../../ArvoContract/versioned/index.js';
import type { ArvoDomainInput } from '../../ArvoDomain/types.js';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { createArvoEventFactory } from '../../factories/ArvoEventFactory/index.js';
import type { ArvoHandlerErrorAddressing } from './types.js';

/**
 * This contract's handler error event, addressed to whoever opened the
 * execution, or `null` where it could not be built.
 *
 * The one event an executor may never produce: it says the work cannot be
 * done, which is the handler's to say. Built the same way whether the
 * execution failed or is being given up on, so the caller reads one shape
 * either way.
 *
 * `null` rather than thrown on, because every caller of this is already
 * reporting a failure and must not lose it to a second one.
 *
 * @param self - The version of the contract the execution implements.
 * @param addressing - Where the execution sits and what it answers to.
 * @param message - What went wrong, which the caller reads.
 * @param domain - Which processing path the event takes, or `null` for
 * ordinary traffic.
 */
export const buildHandlerErrorEvent = (
  self: VersionedArvoContract,
  addressing: ArvoHandlerErrorAddressing,
  message: string,
  domain: ArvoDomainInput | null,
): ArvoEvent | null => {
  const built = createArvoEventFactory(self).tryCreateError({
    error: new Error(message),
    domain: domain ?? undefined,
    source: addressing.source,
    subject: addressing.subject,
    to: addressing.initEvent.source,
    executionid: addressing.parentExecutionId,
    parentid: addressing.event.id,
    initid: addressing.initEvent.id,
    depth: addressing.depth,
  });

  return built.ok ? built.value : null;
};
