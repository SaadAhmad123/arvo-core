import type {
  ArvoOutboxBufferCapacity,
  ArvoOutboxCapacityStatus,
} from '../../../ArvoOutbox/types/capacity.js';
import type { ArvoMemoryOutboxBuffer } from '../types.js';

/** The most a buffer holds before it is exhausted, as a whole number. */
const limitCountOfBuffer = (buffer: ArvoMemoryOutboxBuffer): number =>
  Math.floor(buffer.size * (1 + buffer.tolerance));

/** The status of a buffer holding `heldCount` with the limit given. */
const statusOfBuffer = (param: {
  readonly heldCount: number;
  readonly limitCount: number;
  readonly buffer: ArvoMemoryOutboxBuffer;
  readonly tolerating: boolean;
}): ArvoOutboxCapacityStatus => {
  if (param.heldCount > param.limitCount) return 'exhausted';
  if (param.heldCount > param.buffer.size || param.tolerating)
    return 'tolerating';
  return 'available';
};

/**
 * One buffer's capacity holding `heldCount`: exhausted past its limit, else
 * tolerating past its size or while its steady flag is set, else available.
 */
export const bufferCapacity = (param: {
  readonly heldCount: number;
  readonly buffer: ArvoMemoryOutboxBuffer;
  readonly tolerating: boolean;
}): ArvoOutboxBufferCapacity => {
  const limitCount = limitCountOfBuffer(param.buffer);
  return {
    status: statusOfBuffer({ ...param, limitCount }),
    heldCount: param.heldCount,
    targetCount: param.buffer.size,
    limitCount,
  };
};

/** Whether a buffer holding `heldCount` has drained far enough to stop tolerating. */
export const isDrained = (
  heldCount: number,
  buffer: ArvoMemoryOutboxBuffer,
): boolean => heldCount <= Math.floor(buffer.size * (1 - buffer.tolerance));
