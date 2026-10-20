import type {
  ArvoExecutionContext,
  IArvoEventHandlerMiddleware,
} from 'arvo-core';

/**
 * Which tenant an execution works for, resolved once before any executor
 * runs and left in middleware data for every executor to read.
 *
 * The tenant is derived from the workflow's subject, so every execution
 * of one workflow agrees on it without anything being stored. A layer
 * rather than a line in each executor, because it belongs to every
 * handler and to none.
 */

/** Where the tenant is left in middleware data. */
export const TENANT_KEY = 'tenant';

/** The tenant one workflow works for. */
export const tenantOfSubject = (subject: string): string =>
  `tenant-${subject.split('-')[0] ?? subject}`;

export class RequireTenant
  implements IArvoEventHandlerMiddleware<'require_tenant'>
{
  readonly id = 'require_tenant' as const;

  async before(ctx: ArvoExecutionContext): Promise<void> {
    await ctx.setMiddleware(TENANT_KEY, tenantOfSubject(ctx.state.subject));
  }
}

/**
 * The tenant an executor works for, as the layer left it.
 *
 * Refuses rather than guesses where the layer did not run: an executor
 * working for no tenant is a misconfigured handler, and another attempt
 * would not configure it.
 *
 * @throws A fault built through the context, no further attempt in
 * prospect, where no tenant was left.
 */
export const tenantFor = async (ctx: {
  readonly middleware: Readonly<Record<string, unknown>>;
  readonly state: { readonly subject: string };
  fault: ArvoExecutionContext['fault'];
}): Promise<string> => {
  const tenant = ctx.middleware[TENANT_KEY];
  if (typeof tenant === 'string') return tenant;
  throw await ctx.fault({
    faultKind: 'executor_raised',
    message: `no tenant was resolved for ${ctx.state.subject}; the require_tenant layer did not run`,
    retryable: false,
  });
};
