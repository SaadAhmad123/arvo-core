import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * No two distinct handlers may implement self contracts of one `type`, whether
 * or not their `uri`s differ: a dispatcher picks a handler by `event.to`,
 * which carries the `type` alone.
 *
 * @param handlers - The flattened handler list.
 */
export const checkSharedTypes = (
  handlers: readonly ArvoAnyEventHandler[],
): ErrorIssue[] => {
  const handlersByType = new Map<string, Set<ArvoAnyEventHandler>>();
  for (const handler of handlers) {
    const contractType: string = handler.contracts.self.type;
    handlersByType.set(
      contractType,
      (handlersByType.get(contractType) ?? new Set()).add(handler),
    );
  }
  return [...handlersByType]
    .filter(([, sharing]) => sharing.size > 1)
    .map(([contractType, sharing]) => {
      const uris = [...sharing].map((handler) => handler.contracts.self.uri);
      return new ErrorIssue({
        path: 'handlers',
        message: `holds ${sharing.size} handlers implementing ${contractType} (uris: ${uris.join(', ')}); a dispatcher picks a handler by the event's to, which carries the type alone, so each type may be implemented once`,
        received: contractType,
      });
    });
};
