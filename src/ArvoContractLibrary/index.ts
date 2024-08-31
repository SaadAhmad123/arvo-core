import ArvoContract from '../ArvoContract';

/**
 * Extracts the URI type from a given ArvoContract type.
 * @template T - The ArvoContract type to extract from.
 */
type ExtractContractUri<T> = T extends { uri: infer U } ? U : never;

/**
 * A library class for managing and accessing ArvoContract instances.
 * @template T - The type of ArvoContract stored in the library.
 */
export default class ArvoContractLibrary<T extends ArvoContract> {
  /**
   * The array of ArvoContract instances stored in the library.
   * @private
   * @readonly
   */
  private readonly _contracts: Array<T>;

  /**
   * Creates an instance of ArvoContractLibrary.
   * @param {T[]} contracts - An array of ArvoContract instances to initialize the library.
   * @throws An error in case the URI are duplicated
   */
  constructor(contracts: T[]) {
    const uriSet = new Set<string>();
    contracts.forEach((contract) => {
      if (uriSet.has(contract.uri)) {
        throw new Error(`Duplicate contract URI found: ${contract.uri}`);
      }
      uriSet.add(contract.uri);
    });
    this._contracts = [...contracts];
  }

  /**
   * Returns a readonly array of all ArvoContract instances in the library.
   * @returns {Array<T>} A readonly array of ArvoContract instances.
   */
  public list(): Array<T> {
    return Object.freeze([...this._contracts]) as Array<T>;
  }

  /**
   * Retrieves an ArvoContract instance by its URI.
   * @template U - The type of the URI to search for.
   * @param {U} uri - The URI of the contract to retrieve.
   * @returns {Extract<T, { uri: U }>} A readonly ArvoContract instance matching the given URI.
   * @throws {Error} If no contract with the given URI is found in the library.
   */
  public get<U extends ExtractContractUri<T>>(uri: U): Extract<T, { uri: U }> {
    const contract = this._contracts.find((item) => item.uri === uri);
    if (!contract) {
      throw new Error(
        `ArvoContract with URI "${uri}" not found in the library`,
      );
    }
    return Object.freeze(contract) as Extract<T, { uri: U }>;
  }

  /**
   * Checks if the library contains a contract with the given URI.
   * @param {string} uri - The URI to check for.
   * @returns {boolean} True if a contract with the given URI exists in the library, false otherwise.
   */
  public has(uri: string): boolean {
    return this._contracts.some((contract) => contract.uri === uri);
  }

  /**
   * Returns the number of contracts in the library.
   * @returns {number} The number of contracts in the library.
   */
  public get size(): number {
    return this._contracts.length;
  }
}
