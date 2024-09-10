import { IArvoContract } from './types';
import ArvoContract from '.';

/**
 * Infers the ArvoContract type from a given IArvoContract.
 */
export type InferArvoContract<T> =
  T extends IArvoContract<infer S, infer U, infer V, infer W>
    ? ArvoContract<S, U, V, W>
    : never;

/**
 * Creates an ArvoContract instance from the given contract specification.
 *
 * This function provides a convenient way to create and initialize an ArvoContract
 * with proper type inference.
 *
 * @template TContract - The type of the contract specification.
 *
 * @param contract - The contract specification object.
 *   This should include the URI, accepts, and emits properties as defined in IArvoContract.
 *
 * @returns The created ArvoContract instance.
 *   The returned type is inferred from the input contract specification.
 *
 * @example
 * const myContract = createArvoContract({
 *   uri: 'https://example.com/contracts/myContract',
 *   accepts: {
 *     type: 'com.example.input',
 *     schema: z.object({ name: z.string() }),
 *   },
 *   emits: {
 *     'com.example.output': z.object({ result: z.number() }),
 *   },
 * });
 */
export const createArvoContract = <const TContract extends IArvoContract>(
  contract: TContract,
): InferArvoContract<TContract> =>
  new ArvoContract(contract) as InferArvoContract<TContract>;
