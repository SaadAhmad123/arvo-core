import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * The set must hold at least one handler once flattened. An empty set blocks
 * every other rule, each of which compares handlers.
 *
 * @param handlers - The flattened handler list.
 */
export const checkEmpty = (
  handlers: readonly ArvoAnyEventHandler[],
): ErrorIssue[] =>
  handlers.length > 0
    ? []
    : [
        new ErrorIssue({
          path: 'handlers',
          message:
            'must hold at least one handler once flattened; a dispatcher with none has nothing to enter',
          received: handlers,
          blockingReason:
            'every other rule compares the handlers in the set, and there are none',
        }),
      ];
