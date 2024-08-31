import ArvoContractLibrary from '.';
import ArvoContract from '../ArvoContract';

/**
 * Creates a new ArvoContractLibrary instance with the given ArvoContract instances.
 * 
 * @template T - The type of ArvoContract to be stored in the library.
 * @param {...T[]} args - One or more ArvoContract instances to initialize the library.
 * @returns {ArvoContractLibrary<T>} A new ArvoContractLibrary instance containing the provided contracts.
 */
export const createArvoContractLibrary = <T extends ArvoContract>(
  ...args: T[]
) => new ArvoContractLibrary(args);
