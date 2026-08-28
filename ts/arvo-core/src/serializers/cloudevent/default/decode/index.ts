import type { ErrorIssue } from '../../../../utils/error-issue.js';
import type { CloudEvent } from '../../types.js';
import { ARVO_MEDIA_TYPE, DATA_SCHEMA } from '../constants.js';
import { parseDataContentType } from '../content-type.js';

export type Decoded = {
  candidate: Record<string, unknown>;
  issues: ErrorIssue[];
};

/** Whether `data` claims Arvo shape at all, via either marker — the branch point between attempting strict decoding and foreign adaptation. */
export const claimsArvoShape = (data: CloudEvent): boolean => {
  const parsed = parseDataContentType(data.datacontenttype);
  return (
    parsed?.mediaType === ARVO_MEDIA_TYPE || data.dataschema === DATA_SCHEMA
  );
};

export { decodeForeign } from './foreign.js';
export { decodeStrict } from './strict.js';
