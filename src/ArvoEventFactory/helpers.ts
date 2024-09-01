import ArvoEventFactory from ".";
import ArvoContract from "../ArvoContract";
import { z } from 'zod'

/**
 * Creates a ArvoEventFactory instance based on the provided contract.
 *
 * @template TUri - The URI of the contract
 * @template TType - The accept type, defaults to string.
 * @template TAcceptSchema - The type of the data which the contract bound can accept
 * @template TEmits - The type of records the contract bound handler emits.
 *
 * @param contract - The ArvoContract to base the events on.
 * @returns An instance of ContractualArvoEventFactory.
 */
export const createArvoEventFactory = <
  TUri extends string = string,
  TType extends string = string,
  TAcceptSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TEmits extends Record<string, z.ZodTypeAny> = Record<string, z.ZodTypeAny>,
>(
  contract: ArvoContract<TUri, TType, TAcceptSchema, TEmits>,
) => new ArvoEventFactory(contract);