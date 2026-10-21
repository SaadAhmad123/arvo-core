import {
  type ArvoEvent,
  type ArvoEventHandlerMiddlewareEntry,
  type ArvoExecutionContext,
  type ArvoExecutorEmission,
  createArvoEventFactory,
  type IArvoEventHandlerMiddleware,
} from 'arvo-core';
import { inventoryCheckV1 } from '../handler/com_inventory_check/contract.js';

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
 * them without threading a plan through each one's startup. A chaos run
 * aims a different failure at each workflow instead, by the workflow's
 * subject, which every execution of one workflow carries.
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
  | {
      /** A before part that takes `ms` before it returns. */
      readonly kind: 'slow_before';
      readonly ms: number;
      /** How many attempts are slow before one is not; every one where omitted. */
      readonly slowAttempts?: number;
    }
  | { readonly kind: 'throw_after' }
  | { readonly kind: 'fault_after' }
  | { readonly kind: 'hang_after'; readonly ms: number }
  /** An after part that writes the record, which must not reach it. */
  | { readonly kind: 'write_after' }
  /**
   * A layer that tries to change what it may only read: the middleware
   * data in its before part, the emission in its after part.
   */
  | { readonly kind: 'tamper' }
  /** A layer whose parts both return an answer of their own. */
  | { readonly kind: 'answer_from_layer' }
  | { readonly kind: 'duplicate_key' }
  | { readonly kind: 'duplicate_id' }
  /** The way to make the injection layer throws. */
  | { readonly kind: 'factory_throws' }
  /** The way to make the injection layer returns something that is not one. */
  | { readonly kind: 'factory_returns_nothing' }
);

let injected: InjectedFailure | null = null;
let injectedBySubject: ReadonlyMap<string, InjectedFailure> = new Map();

/** Injects a failure into every delivery from now until it is cleared. */
export const injectFailure = (failure: InjectedFailure | null): void => {
  injected = failure;
};

/**
 * Aims one failure at each workflow, by its subject, from now until
 * cleared. A failure injected into every delivery takes precedence.
 *
 * Clearing also forgets every tampering and every slow part counted so
 * far, so one chaos run reads only its own.
 */
export const injectFailuresBySubject = (
  plan: ReadonlyMap<string, InjectedFailure> | null,
): void => {
  injectedBySubject = plan ?? new Map();
  if (plan === null) {
    tamperingsThatTookEffect.length = 0;
    slowBeforePartsEntered = 0;
  }
};

/** What a layer returns or writes in place of what it may not, so it can be told apart. */
export const FORGED_HELD = 424_242;

/** Every attempt by a layer to change what it may only read that worked. */
const tamperingsThatTookEffect: string[] = [];

/** Every tampering that took effect since the last clearing. A conformant handler leaves this empty. */
export const layerTamperingsThatTookEffect = (): readonly string[] => [
  ...tamperingsThatTookEffect,
];

let slowBeforePartsEntered = 0;

/**
 * How many slow before parts have been entered since the last clearing,
 * so a spec can act while deliveries are inside one rather than sleeping.
 */
export const slowBeforePartsEnteredSoFar = (): number => slowBeforePartsEntered;

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

/** Whether a delivery is one the failure was aimed at, before any context exists. */
const aimedAtEvent = (failure: InjectedFailure, triggeringEvent: ArvoEvent) =>
  failure.into === undefined || failure.into === triggeringEvent.to;

/** Sets one property through reflection and says whether it now holds the value. */
const tookEffect = (target: object, key: string, value: unknown): boolean => {
  try {
    Reflect.set(target, key, value);
  } catch {
    return false;
  }
  return Reflect.get(target, key) === value;
};

/** Tries every way an after part could change the emission, and notes any that worked. */
const tamperWithEmission = (
  contractType: string,
  emission: Readonly<ArvoExecutorEmission>,
): void => {
  const events = Array.isArray(emission) ? emission : [emission];
  if (Array.isArray(emission)) {
    if (tookEffect(emission, String(emission.length), null)) {
      tamperingsThatTookEffect.push(
        `${contractType}: an event appended to the emission`,
      );
    }
  }
  for (const event of events) {
    if (event === null || event === undefined || typeof event !== 'object')
      continue;
    if (tookEffect(event, 'type', 'evt_forged')) {
      tamperingsThatTookEffect.push(
        `${contractType}: an emitted event's type replaced`,
      );
    }
    const data: unknown = Reflect.get(event, 'data');
    if (
      data !== null &&
      typeof data === 'object' &&
      tookEffect(data, 'held', FORGED_HELD)
    ) {
      tamperingsThatTookEffect.push(
        `${contractType}: an emitted event's data replaced`,
      );
    }
  }
};

/**
 * An answer to the inventory check built by a layer, by hand, with a
 * value no executor produces, so a spec can see whether it was emitted.
 */
const forgedAnswer = (ctx: ArvoExecutionContext): ArvoEvent =>
  createArvoEventFactory(inventoryCheckV1).createOutput({
    type: 'evt_inventory_checked',
    source: inventoryCheckV1.type,
    subject: ctx.state.subject,
    to: ctx.state.source,
    data: { sku: 'forged', held: FORGED_HELD, sufficient: true },
  });

/**
 * A before part that answers in the executor's place. Typed to return
 * nothing, as a layer's part is, which TypeScript permits a function
 * returning something to be — so a layer can return an answer without
 * any cast, and the protocol must still not read it.
 */
const answerBefore: (ctx: ArvoExecutionContext) => void = (ctx) =>
  forgedAnswer(ctx);

/** The same, after the executor returned. */
const answerAfter: (
  ctx: ArvoExecutionContext,
  emission: Readonly<ArvoExecutorEmission>,
) => void = (ctx) => [forgedAnswer(ctx)];

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
    case 'slow_before':
      return {
        id: 'injection',
        before: async (ctx) => {
          if (!aimedAt(failure, ctx)) return;
          if (
            failure.slowAttempts !== undefined &&
            ctx.attempt >= failure.slowAttempts
          ) {
            return;
          }
          slowBeforePartsEntered += 1;
          await new Promise((settle) => setTimeout(settle, failure.ms));
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
    case 'fault_after':
      return {
        id: 'injection',
        after: async (ctx) => {
          if (!aimedAt(failure, ctx)) return;
          throw await ctx.fault({
            faultKind: 'executor_raised',
            message: 'injected: after part faulted',
            retryable: false,
          });
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
    case 'write_after':
      return {
        id: 'injection',
        after: async (ctx) => {
          if (!aimedAt(failure, ctx)) return;
          // fits the inventory check's own schema, so only the rule
          // that an after part cannot reach the record can refuse it
          await ctx.setState({
            data: { sku: 'forged', held: FORGED_HELD, reserved: FORGED_HELD },
          });
        },
      };
    case 'tamper':
      return {
        id: 'injection',
        before: (ctx) => {
          if (!aimedAt(failure, ctx)) return;
          if (tookEffect(ctx.middleware, 'tenant', 'tenant-forged')) {
            tamperingsThatTookEffect.push(
              `${ctx.contracts.self.type}: middleware data written through the read member`,
            );
          }
        },
        after: (ctx, emission) => {
          if (aimedAt(failure, ctx))
            tamperWithEmission(ctx.contracts.self.type, emission);
        },
      };
    case 'answer_from_layer':
      return { id: 'injection', before: answerBefore, after: answerAfter };
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
    case 'factory_throws':
    case 'factory_returns_nothing':
      // refused by `injectionEntryFor` before a layer is made
      return { id: 'injection' };
  }
};

/** The entry that makes the injection layer, which may itself be the failure. */
const injectionEntryFor = (
  failure: InjectedFailure | null,
  triggeringEvent: ArvoEvent,
): ArvoEventHandlerMiddlewareEntry => {
  if (failure !== null && aimedAtEvent(failure, triggeringEvent)) {
    if (failure.kind === 'factory_throws') {
      return () => {
        throw new Error('injected: the way to make a layer threw');
      };
    }
    if (failure.kind === 'factory_returns_nothing') {
      // deliberately invalid: a way to make a layer that makes none
      return () => null as unknown as IArvoEventHandlerMiddleware;
    }
  }
  return () => injectionFor(failure);
};

/**
 * What a mechanism supplies with one delivery.
 *
 * @param mechanism - Which mechanism is carrying it.
 * @param triggeringEvent - The event being delivered, whose subject
 * says which workflow's failure, if any, is aimed at it.
 */
export const deliveryMiddleware = (
  mechanism: Mechanism,
  triggeringEvent: ArvoEvent,
): readonly ArvoEventHandlerMiddlewareEntry[] => {
  const failure =
    injected ?? injectedBySubject.get(triggeringEvent.subject) ?? null;
  const entries: ArvoEventHandlerMiddlewareEntry[] = [
    deliveredBy(mechanism),
    injectionEntryFor(failure, triggeringEvent),
  ];
  if (failure?.kind === 'duplicate_id') {
    entries.push(() => injectionFor(failure));
  }
  return entries;
};
