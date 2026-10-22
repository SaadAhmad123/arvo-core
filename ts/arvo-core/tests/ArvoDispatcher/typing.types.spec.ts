import { describe, expect, expectTypeOf, it } from 'vitest';
import type { ArvoDispatcherExecuteParam } from '../../src/ArvoDispatcher/types.js';
import type {
  DependenciesOf,
  HandlersOf,
  HooksOf,
} from '../../src/ArvoDispatcher/typing.js';
import type { IArvoEventHandlerDependency } from '../../src/ArvoEventHandler/types/dependency.js';
import type { ArvoNone } from '../../src/ArvoEventHandler/types/supplied.js';
import type {
  auditHandler,
  orderHandler,
  paymentHandler,
  ticketCountingHandler,
} from './fixtures.js';

/**
 * The type level, run so it compiles where the suite does.
 *
 * Each `@ts-expect-error` is an assertion: if the line stopped being an
 * error, `pnpm typecheck` would fail on the directive itself.
 */

type Order = ReturnType<typeof orderHandler>;
type Payment = ReturnType<typeof paymentHandler>;
type Audit = ReturnType<typeof auditHandler>;
type TicketCounting = ReturnType<typeof ticketCountingHandler>;

/** A set as the type helpers read one: whatever holds a flattened handler list. */
type SetOf<THandlers extends readonly unknown[]> = {
  readonly handlers: THandlers;
};

describe('what the type helpers read off a set', () => {
  it('flattens handlers in order, a set contributing its own', () => {
    expectTypeOf<HandlersOf<[Order, SetOf<[Payment, Audit]>]>>().toEqualTypeOf<
      [Order, Payment, Audit]
    >();
  });

  it('flattens sets nested inside sets', () => {
    expectTypeOf<
      HandlersOf<[SetOf<[SetOf<[Order]>, Payment]>, Audit]>
    >().toEqualTypeOf<[Order, Payment, Audit]>();
  });

  it('keys each dependency entry by the handler’s literal self contract type', () => {
    type Dependencies = DependenciesOf<[Order, Payment]>;
    expectTypeOf<keyof Dependencies>().toEqualTypeOf<
      'com_order_create' | 'com_payment_charge'
    >();
  });

  it('types each entry to what its own handler declares', () => {
    type Dependencies = DependenciesOf<[Order, Payment]>;
    expectTypeOf<Dependencies['com_order_create']>().toEqualTypeOf<
      IArvoEventHandlerDependency<{ orders: string }> | undefined
    >();
    expectTypeOf<Dependencies['com_payment_charge']>().toEqualTypeOf<
      IArvoEventHandlerDependency<{ ledger: number }> | undefined
    >();
  });

  it('gives a handler that declares nothing an entry with nothing in it', () => {
    expectTypeOf<DependenciesOf<[Audit]>['com_audit_record']>().toEqualTypeOf<
      IArvoEventHandlerDependency<ArvoNone> | undefined
    >();
  });

  it('refuses an entry of the wrong shape for its handler', () => {
    const dependencies: DependenciesOf<[Order, Payment]> = {
      com_payment_charge: {
        // @ts-expect-error the payment handler declares a numeric ledger
        attributes: { ledger: 'not a number' },
        open: () => undefined,
        close: () => undefined,
      },
    };
    expect(Object.keys(dependencies)).toHaveLength(1);
  });

  it('asks for hooks every handler can accept', () => {
    expectTypeOf<HooksOf<[Order, Audit]>>().toEqualTypeOf<
      { ticket: string } & ArvoNone
    >();
  });

  it('accepts no value where two handlers’ hooks cannot both be met', () => {
    // @ts-expect-error the order handler wants a string ticket, the other a number
    const hooks: HooksOf<[Order, TicketCounting]> = { ticket: 'T-1' };
    expect(hooks).toBeDefined();
  });

  it('enters a set with what a handler takes, less layers, widened for the set', () => {
    type Param = ArvoDispatcherExecuteParam<[Order, Payment]>;
    expectTypeOf<Param['dependencies']>().toEqualTypeOf<
      DependenciesOf<[Order, Payment]> | undefined
    >();
    expectTypeOf<Param>().not.toHaveProperty('middleware');
  });

  it('still types a large, deeply nested set', () => {
    type Deep = HandlersOf<
      [
        SetOf<[SetOf<[SetOf<[SetOf<[Order]>]>]>]>,
        SetOf<[Payment, SetOf<[Audit, SetOf<[Order, Payment]>]>]>,
        Audit,
        Order,
        SetOf<[Payment, Audit, Order, Payment, Audit]>,
      ]
    >;
    expectTypeOf<Deep['length']>().toEqualTypeOf<12>();
  });
});
