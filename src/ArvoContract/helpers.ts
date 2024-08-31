import { IArvoContract } from './types';
import ArvoContract, { ExtractEventType } from '.';
import { createArvoEvent } from '../ArvoEvent/helpers';
import { CreateArvoEvent } from '../ArvoEvent/types';
import { createOtelSpan } from '../OpenTelemetry';
import { TelemetryContext } from '../OpenTelemetry/types';
import { ArvoContractRecord } from './types';
import { z } from 'zod';

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
 * with proper type inference.
 *
 * @template TContract - The type of the contract specification.
 * @param {TContract} contractSpec - The contract specification object.
 *   This should include the URI, accepts, and emits properties as defined in IArvoContract.
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
): InferArvoContract<TContract> =>
  new ArvoContract(contract) as InferArvoContract<TContract>;

/**
 * Creates a contractual ArvoEvent factory based on the provided contract.
 *
 * @template T - The type of the contract.
 * @template TAccepts - The type of events the contract accepts.
 * @template TEmits - The type of events the contract emits.
 * @param {ArvoContract<T, TAccepts, TEmits>} contract - The ArvoContract to base the events on.
 * @returns {Object} An object with 'accepts' and 'emits' methods for creating events.
 */
export const createContractualArvoEvent = <
  T extends string = string,
  TAccepts extends ArvoContractRecord = ArvoContractRecord,
  TEmits extends ArvoContractRecord = ArvoContractRecord,
>(
  contract: ArvoContract<T, TAccepts, TEmits>,
) => ({
  /**
   * Creates an ArvoEvent as per the accept record of the contract.
   *
   * @template TExtension - The type of extensions to add to the event.
   * @param {CreateArvoEvent<z.infer<TAccepts['schema']>, TAccepts['type']>} event - The event to create.
   * @param {TExtension} [extensions] - Optional extensions to add to the event.
   * @param {TelemetryContext} [telemetry] - Optional telemetry context for tracing.
   * @returns The created ArvoEvent as per the accept record of the contract.
   * @throws {Error} If the event data fails validation against the contract.
   */
  accepts: <TExtension extends Record<string, any>>(
    event: CreateArvoEvent<z.infer<TAccepts['schema']>, TAccepts['type']>,
    extensions?: TExtension,
    telemetry?: TelemetryContext,
  ) =>
    createOtelSpan(
      telemetry || 'ArvoEvent Creation Tracer',
      'createArvoContractEvent.accepts',
      {},
      () => {
        const validationResult = contract.validateInput(event.type, event.data);
        if (!validationResult.success) {
          throw new Error(
            `Accept Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<
          z.infer<z.infer<TAccepts['schema']>>,
          TExtension,
          TAccepts['type']
        >(
          {
            ...event,
            data: validationResult.data,
          },
          extensions,
          telemetry,
        );
      },
    ),

  /**
   * Creates an ArvoEvent as per one of the emits record in the contract.
   *
   * @template U - The specific event type from TEmits.
   * @template TExtension - The type of extensions to add to the event.
   * @param {CreateArvoEvent<z.infer<Extract<TEmits, { type: U }>['schema']>, U>} event - The event to create.
   * @param {TExtension} [extensions] - Optional extensions to add to the event.
   * @param {TelemetryContext} [telemetry] - Optional telemetry context for tracing.
   * @returns The created ArvoEvent as per one of the emits records of the contract.
   * @throws {Error} If the event data fails validation against the contract.
   */
  emits: <
    U extends ExtractEventType<TEmits>,
    TExtension extends Record<string, any>,
  >(
    event: CreateArvoEvent<z.infer<Extract<TEmits, { type: U }>['schema']>, U>,
    extensions?: TExtension,
    telemetry?: TelemetryContext,
  ) =>
    createOtelSpan(
      telemetry || 'ArvoEvent Creation Tracer',
      'createArvoContractEvent.emits',
      {},
      () => {
        const validationResult = contract.validateOutput(
          event.type,
          event.data,
        );
        if (!validationResult.success) {
          throw new Error(
            `Emit Event data validation failed: ${validationResult.error.message}`,
          );
        }
        return createArvoEvent<
          z.infer<Extract<TEmits, { type: U }>['schema']>,
          TExtension,
          U
        >(
          {
            ...event,
            data: validationResult.data,
          },
          extensions,
          telemetry,
        );
      },
    ),
});
