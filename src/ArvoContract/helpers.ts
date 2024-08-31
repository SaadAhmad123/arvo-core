import { IArvoContract } from './types';
import ArvoContract from '.';
import { TelemetryContext } from '../OpenTelemetry/types';
import { createOtelSpan } from '../OpenTelemetry';

/**
 * Infers the ArvoContract type from a given IArvoContract.
 */
export type InferArvoContract<T> =
  T extends IArvoContract<infer U, infer V, infer W>
    ? ArvoContract<U, V, W>
    : never;

/**
 * Creates an ArvoContract instance from the given contract specification.
 *
 * This function provides a convenient way to create and initialize an ArvoContract
 * with proper type inference. It also supports optional telemetry for tracing.
 *
 * @template TContract - The type of the contract specification.
 * @param {TContract} contractSpec - The contract specification object.
 *   This should include the URI, accepts, and emits properties as defined in IArvoContract.
 * @param {TelemetryContext} [telemetry] - Optional telemetry context for tracing.
 *   If provided, it will be used to create an OpenTelemetry span for the contract creation.
 *
 * @returns {InferArvoContract<TContract>} The created ArvoContract instance.
 *   The returned type is inferred from the input contract specification.
 *
 * @example
 * const myContract = createArvoContract({
 *   uri: 'https://example.com/contracts/myContract',
 *   accepts: {
 *     type: 'com.example.input',
 *     schema: z.object({ name: z.string() }),
 *   },
 *   emits: [
 *     {
 *       type: 'com.example.output',
 *       schema: z.object({ result: z.number() }),
 *     },
 *   ],
 * });
 */
export const createArvoContract = <const TContract extends IArvoContract>(
  contract: TContract,
  telemetry?: TelemetryContext,
): InferArvoContract<TContract> =>
  createOtelSpan(
    telemetry || 'Arvo Contract Creator',
    'Create ArvoContract',
    {},
    () => new ArvoContract(contract) as InferArvoContract<TContract>,
  );
