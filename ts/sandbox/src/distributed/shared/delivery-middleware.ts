import type {
  ArvoEventHandlerMiddlewareEntry,
  ArvoExecutionContext,
  IArvoEventHandlerMiddleware,
} from 'arvo-core';

/**
 * The layers each mechanism supplies with every delivery.
 *
 * Two, always: one saying which mechanism carried the delivery, and one
 * made per execution from whatever failure a test has asked to inject —
 * a layer that does nothing where none was asked for. Supplied rather
 * than declared, so they run outside the handlers' own layers under every
 * mechanism, which is the order ADR-016 fixes.
 *
 * The injection is process-wide on purpose: all three mechanisms run
 * their deliveries in the test process, so one switch reaches all of
 * them without threading a plan through each one's startup.
 */

export type Mechanism = 'temporal' | 'dbos' | 'replay';

/** A failure to inject, and which handler to inject it into. */
export type InjectedFailure = {
  /** The contract type to inject into; every handler where omitted. */
  readonly into?: string;
} & (
  | { readonly kind: 'throw_before' }
  | {
      readonly kind: 'fault_before';
      readonly retryable: boolean;
      /** How many attempts fail before one succeeds; every one where omitted. */
      readonly failingAttempts?: number;
    }
  | { readonly kind: 'throw_after' }
  | { readonly kind: 'hang_after'; readonly ms: number }
  | { readonly kind: 'duplicate_key' }
  | { readonly kind: 'duplicate_id' }
);

let injected: InjectedFailure | null = null;

/** Injects a failure into every delivery from now until it is cleared. */
export const injectFailure = (failure: InjectedFailure | null): void => {
  injected = failure;
};

/** Which mechanism carried a delivery, on its span. */
const deliveredBy = (
  mechanism: Mechanism,
): IArvoEventHandlerMiddleware<'delivered_by'> => ({
  id: 'delivered_by',
  before: (ctx) => {
    ctx.telemetry.setAttributes({ 'sandbox.mechanism': mechanism });
  },
});

/** Whether a delivery is one the failure was aimed at. */
const aimedAt = (failure: InjectedFailure, ctx: ArvoExecutionContext) =>
  failure.into === undefined || failure.into === ctx.contracts.self.type;

/** The layer one delivery runs for the failure in force, or a quiet one. */
const injectionFor = (
  failure: InjectedFailure | null,
): IArvoEventHandlerMiddleware => {
  if (failure === null) return { id: 'injection' };
  switch (failure.kind) {
    case 'throw_before':
      return {
        id: 'injection',
        before: (ctx) => {
          if (aimedAt(failure, ctx))
            throw new Error('injected: before part threw');
        },
      };
    case 'fault_before':
      return {
        id: 'injection',
        before: async (ctx) => {
          if (!aimedAt(failure, ctx)) return;
          if (
            failure.failingAttempts !== undefined &&
            ctx.attempt >= failure.failingAttempts
          ) {
            return;
          }
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'injected: before part faulted',
            retryable: failure.retryable,
          });
        },
      };
    case 'throw_after':
      return {
        id: 'injection',
        after: (ctx) => {
          if (aimedAt(failure, ctx))
            throw new Error('injected: after part threw');
        },
      };
    case 'hang_after':
      return {
        id: 'injection',
        after: async (ctx) => {
          if (aimedAt(failure, ctx)) {
            await new Promise((settle) => setTimeout(settle, failure.ms));
          }
        },
      };
    case 'duplicate_key':
      return {
        id: 'injection',
        before: async (ctx) => {
          // one key written twice, which the context refuses
          if (!aimedAt(failure, ctx)) return;
          await ctx.setMiddleware('injected', 1);
          await ctx.setMiddleware('injected', 2);
        },
      };
    case 'duplicate_id':
      // listed twice by `deliveryMiddleware`, so the identifier repeats
      return { id: 'injection_twice' };
  }
};

/**
 * What a mechanism supplies with one delivery.
 *
 * @param mechanism - Which mechanism is carrying it.
 */
export const deliveryMiddleware = (
  mechanism: Mechanism,
): readonly ArvoEventHandlerMiddlewareEntry[] => {
  const failure = injected;
  const entries: ArvoEventHandlerMiddlewareEntry[] = [
    deliveredBy(mechanism),
    () => injectionFor(failure),
  ];
  if (failure?.kind === 'duplicate_id') {
    entries.push(() => injectionFor(failure));
  }
  return entries;
};
