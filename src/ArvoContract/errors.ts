/**
 * Custom error class representing a violation of an ArvoContract.
 */
export class ArvoContractViolationError extends Error {
    /**
     * Creates an instance of ArvoContractViolationError.
     * @param {string} [message='ArvoContract violated'] - The error message. Default is 'ArvoContract violated'.
     */
    constructor(message: string = 'ArvoContract violated') {
      super(message);
      this.name = 'ArvoContractViolationError';
    }
  }