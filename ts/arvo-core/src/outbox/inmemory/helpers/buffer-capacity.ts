import type {
  ArvoOutboxBufferCapacity,
  ArvoOutboxCapacityStatus,
} from '../../../ArvoOutbox/types/capacity.js';
import type { ArvoMemoryOutboxBuffer } from '../types.js';

/** The most a buffer holds before it is exhausted, as a whole number. */
const limitOfBuffer = (buffer: ArvoMemoryOutboxBuffer): number =>
  Math.floor(buffer.size * (1 + buffer.tolerance));

/** The status of a buffer holding `held` with the limit given. */
const statusOfBuffer = (param: {
  readonly held: number;
  readonly limit: number;
  readonly buffer: ArvoMemoryOutboxBuffer;
  readonly tolerating: boolean;
}): ArvoOutboxCapacityStatus => {
  if (param.held > param.limit) return 'exhausted';
  if (param.held > param.buffer.size || param.tolerating) return 'tolerating';
  return 'available';
};

/**
 * One buffer's capacity holding `held`: exhausted past its limit, else
 * tolerating past its size or while its steady flag is set, else available.
 */
export const bufferCapacity = (param: {
  readonly held: number;
  readonly buffer: ArvoMemoryOutboxBuffer;
  readonly tolerating: boolean;
}): ArvoOutboxBufferCapacity => {
  const limit = limitOfBuffer(param.buffer);
  return {
    status: statusOfBuffer({ ...param, limit }),
    held: param.held,
    size: param.buffer.size,
    limit,
  };
};

/** Whether a buffer holding `held` has drained far enough to stop tolerating. */
export const isDrained = (
  held: number,
  buffer: ArvoMemoryOutboxBuffer,
): boolean => held <= Math.floor(buffer.size * (1 - buffer.tolerance));
