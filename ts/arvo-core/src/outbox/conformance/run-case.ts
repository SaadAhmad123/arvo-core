import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import type { PromiseAble } from '../../types.js';
import type { ArvoOutboxConformanceCase } from './types.js';

/**
 * Runs one case against a new outbox: opens it, runs the check, and closes
 * it whatever happened, throwing what the opening or the check threw before
 * anything closing threw.
 */
export const runConformanceCase = async (
  createOutbox: () => PromiseAble<IArvoOutbox>,
  conformanceCase: ArvoOutboxConformanceCase,
): Promise<void> => {
  const outbox = await createOutbox();
  let caseFailure: { readonly error: unknown } | undefined;
  try {
    await outbox.open();
    await conformanceCase.check(outbox);
  } catch (error_) {
    caseFailure = { error: error_ };
  }
  try {
    await outbox.close();
  } catch (error_) {
    if (caseFailure === undefined) throw error_;
  }
  if (caseFailure !== undefined) throw caseFailure.error;
};
