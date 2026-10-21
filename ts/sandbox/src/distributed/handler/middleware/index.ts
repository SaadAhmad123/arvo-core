import type { ArvoEventHandlerMiddlewareEntry } from 'arvo-core';
import { Stopwatch } from './stopwatch.js';
import { RequireTenant } from './tenant.js';

/**
 * The layers every handler in this run declares.
 *
 * One shared instance and one made per execution, so both ways of
 * listing a layer run under every mechanism.
 */
export const HANDLER_MIDDLEWARE: readonly ArvoEventHandlerMiddlewareEntry[] = [
  new RequireTenant(),
  () => new Stopwatch(),
];

export { TENANT_KEY, tenantFor, tenantOfSubject } from './tenant.js';
