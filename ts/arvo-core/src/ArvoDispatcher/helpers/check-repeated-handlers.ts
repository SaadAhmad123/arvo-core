import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * Each handler instance may appear once after flattening, however it was
 * reached: listed directly, or through a nested dispatcher.
 *
 * @param handlers - The flattened handler list.
 */
export const checkRepeatedHandlers = (
  handlers: readonly ArvoAnyEventHandler[],
): ErrorIssue[] => {
  const countByHandler = new Map<ArvoAnyEventHandler, number>();
  for (const handler of handlers) {
    countByHandler.set(handler, (countByHandler.get(handler) ?? 0) + 1);
  }
  return [...countByHandler]
    .filter(([, count]) => count > 1)
    .map(
      ([handler, count]) =>
        new ErrorIssue({
          path: 'handlers',
          message: `holds the handler for ${handler.contracts.self.type} ${count} times; a dispatcher's handlers are a set, so list each once, directly or through one nested dispatcher`,
          received: handler.contracts.self.type,
        }),
    );
};
