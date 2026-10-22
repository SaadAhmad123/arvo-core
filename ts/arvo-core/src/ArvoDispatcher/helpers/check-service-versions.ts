import { ErrorIssue } from '../../utils/error-issue.js';
import type { ArvoAnyEventHandler } from '../typing.js';

/**
 * A service one handler declares and another in the set implements must be
 * declared at a version, and under a `uri`, the implementer's contract
 * declares. Otherwise every event the first sends the second is refused at
 * the second's gate as unclassifiable. A service nobody here implements is
 * not checked.
 *
 * @param handlers - The flattened handler list.
 */
export const checkServiceVersions = (
  handlers: readonly ArvoAnyEventHandler[],
): ErrorIssue[] =>
  handlers.flatMap((caller) =>
    Object.entries(caller.contracts.services).flatMap(
      ([serviceName, service]) =>
        handlers
          .filter(
            (implementer) => implementer.contracts.self.type === service.type,
          )
          .flatMap((implementer) => {
            const callerType: string = caller.contracts.self.type;
            const implemented = implementer.contracts.self;
            if (service.uri !== implemented.uri) {
              return [
                new ErrorIssue({
                  path: `handlers(${callerType}).contracts.services.${serviceName}`,
                  message: `declares ${service.type} under uri ${service.uri}, but the handler here implements it under uri ${implemented.uri}; every event sent would be refused as unclassifiable, so build both against one contract`,
                  received: service.uri,
                }),
              ];
            }
            if (!Object.hasOwn(implemented.versions, service.version)) {
              return [
                new ErrorIssue({
                  path: `handlers(${callerType}).contracts.services.${serviceName}`,
                  message: `declares ${service.type} at version ${service.version}, which the handler here does not implement (it implements ${Object.keys(implemented.versions).join(', ')}); every event sent would be refused as unclassifiable`,
                  received: service.version,
                }),
              ];
            }
            return [];
          }),
    ),
  );
