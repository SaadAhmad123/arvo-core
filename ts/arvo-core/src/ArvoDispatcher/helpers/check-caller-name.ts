import { isContractIdentifier } from '../../ArvoContract/identifier.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * Whether a name may stand outside a set of handlers. Refused, every rule
 * broken named, where it does not satisfy the contract-declared identifier
 * grammar, equals a handler's self contract type, or equals the type of a
 * service any handler declares.
 *
 * @param callerName - The name asked about.
 * @param handlers - The set's flattened handlers.
 */
export const checkCallerName = (
  callerName: unknown,
  handlers: readonly ArvoAnyEventHandler[],
): ErrorIssue[] => {
  if (typeof callerName !== 'string' || !isContractIdentifier(callerName)) {
    return [
      new ErrorIssue({
        path: 'callerName',
        message:
          'must be lowercase alphanumeric segments joined by single underscores, the grammar a contract type obeys, since answers are addressed to it as to a contract type',
        received: callerName,
      }),
    ];
  }

  const issues: ErrorIssue[] = [];
  for (const handler of handlers) {
    if (handler.contracts.self.type === callerName) {
      issues.push(
        new ErrorIssue({
          path: 'callerName',
          message: `is ${callerName}, the contract a handler here implements; an answer addressed to it would be delivered to that handler as work`,
          received: callerName,
        }),
      );
    }
    for (const [serviceName, service] of Object.entries(
      handler.contracts.services,
    )) {
      if (service.type === callerName) {
        issues.push(
          new ErrorIssue({
            path: 'callerName',
            message: `is ${callerName}, which the handler for ${handler.contracts.self.type} calls as its service ${serviceName}; its requests would be addressed to the outside name, which never asked for them`,
            received: callerName,
          }),
        );
      }
    }
  }
  return issues;
};
