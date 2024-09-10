import { z } from 'zod';
import { cleanString, validateURI } from '../utils';

export const ArvoContractValidators = {
  contract: {
    uri: z
      .string()
      .min(1, 'URI must be a non-empty string')
      .refine(validateURI, 'The URI must a valid URI string')
      .describe(
        cleanString(`
      The addressable unique URI of the contract so that
      it can be located and address for reference during
      operations
    `),
      ),
  },
  record: {
    type: z
      .string()
      .min(1, 'Type must be a non-empty string')
      .regex(
        /^[a-z0-9]+(\.[a-z0-9]+)+\.[a-z0-9]+$/,
        'Type should be prefixed with a reverse-DNS name',
      )
      .describe(
        cleanString(`
        The type of event related to the originating occurrence.
        Should be prefixed with a reverse-DNS name.
      `),
      ),
  },
};
