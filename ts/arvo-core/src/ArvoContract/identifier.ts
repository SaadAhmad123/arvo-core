/**
 * The grammar a contract-declared identifier satisfies: lowercase
 * alphanumeric segments joined by single underscores.
 */
export const CONTRACT_IDENTIFIER_GRAMMAR = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Whether a string satisfies the contract-declared identifier grammar.
 *
 * @param candidate - The string to test.
 */
export const isContractIdentifier = (candidate: string): boolean =>
  CONTRACT_IDENTIFIER_GRAMMAR.test(candidate);
