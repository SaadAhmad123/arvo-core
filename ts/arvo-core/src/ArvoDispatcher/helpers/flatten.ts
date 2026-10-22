import { ArvoEventHandler } from '../../ArvoEventHandler/index.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../../ArvoEventHandler/types/middleware.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type {
  ArvoDispatcherMiddlewareMember,
  ArvoDispatcherSet,
} from '../types.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/** What flattening a declaration came to. */
export type ArvoFlattenedMembers = {
  readonly handlers: readonly ArvoAnyEventHandler[];
  readonly middlewares: readonly ArvoEventHandlerMiddlewareEntry[];
  readonly issues: readonly ErrorIssue[];
};

/**
 * One flat list of handlers and one of layers, from the lists a dispatcher was
 * declared with.
 *
 * A dispatcher's own lists are already flat, so one level is all there is to
 * read. Among the handlers, a dispatcher contributes its handlers; among the
 * layers, its layers, at its position. A handler-list entry that is neither a
 * handler nor a dispatcher is an issue; a layer-list entry that is not a
 * dispatcher is a layer, and is not judged.
 *
 * @param members - The handler list and the layer list as declared.
 * @param isSet - Whether an entry is a dispatcher.
 */
export const flattenMembers = (
  members: {
    readonly handlers: readonly unknown[];
    readonly middlewares: readonly ArvoDispatcherMiddlewareMember[];
  },
  isSet: (candidate: unknown) => candidate is ArvoDispatcherSet,
): ArvoFlattenedMembers => {
  const handlers: ArvoAnyEventHandler[] = [];
  const issues: ErrorIssue[] = [];

  members.handlers.forEach((member, position) => {
    if (member instanceof ArvoEventHandler) {
      handlers.push(member);
    } else if (isSet(member)) {
      handlers.push(...member.handlers);
    } else {
      issues.push(
        new ErrorIssue({
          path: `handlers[${position}]`,
          message:
            'must be a handler, or a dispatcher whose handlers are taken; build a handler with setupArvoEventHandler(...).build()',
          received: member,
        }),
      );
    }
  });

  const middlewares = members.middlewares.flatMap(
    (member): ArvoEventHandlerMiddlewareEntry[] =>
      isSet(member) ? [...member.middlewares] : [member],
  );

  return { handlers, middlewares, issues };
};
