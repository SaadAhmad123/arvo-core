import { describe, expectTypeOf, it } from 'vitest';
import type {
  ArvoDeclaredTypes,
  ArvoDependencies,
  ArvoMechanismHooks,
  ArvoNone,
} from '../../../src/ArvoEventHandler/types/supplied.js';

type Db = { find: () => string };
type Scheduler = { at: (timestamp: number) => void };

/**
 * What the declaration surface will do with the witness: infer both
 * generics off it and carry them to the executor's context.
 *
 * Really implemented rather than declared, so these assertions run. The
 * bodies are empty because only the types are under test, and the
 * inference being tested is the fall-back to a default where the witness
 * names nothing — which a conditional type cannot reproduce, since `infer`
 * yields `unknown` there rather than consulting the default.
 */
const inferSupplied = <
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
>(_param: {
  types?: ArvoDeclaredTypes<TDependencies, TMechanismHooks>;
}): { dependencies: TDependencies; hooks: TMechanismHooks } => ({
  dependencies: {} as TDependencies,
  hooks: {} as TMechanismHooks,
});

describe('declaring the types a mechanism will supply', () => {
  it('infers the dependencies off the witness', () => {
    const inferredTypes = inferSupplied({
      types: {} as { dependencies: Db },
    });
    expectTypeOf(inferredTypes.dependencies).toEqualTypeOf<Db>();
  });

  it('infers the hooks off it too', () => {
    const inferredTypes = inferSupplied({
      types: {} as { mechanismHooks: Scheduler },
    });
    expectTypeOf(inferredTypes.hooks).toEqualTypeOf<Scheduler>();
  });

  it('infers both at once', () => {
    const inferredTypes = inferSupplied({
      types: {} as { dependencies: Db; mechanismHooks: Scheduler },
    });
    expectTypeOf(inferredTypes.dependencies).toEqualTypeOf<Db>();
    expectTypeOf(inferredTypes.hooks).toEqualTypeOf<Scheduler>();
  });

  it('declares nothing for the one left out', () => {
    const inferredTypes = inferSupplied({ types: {} as { dependencies: Db } });
    expectTypeOf(inferredTypes.hooks).toEqualTypeOf<ArvoNone>();
  });

  it('declares nothing at all where the witness is omitted', () => {
    const inferredTypes = inferSupplied({});
    expectTypeOf(inferredTypes.dependencies).toEqualTypeOf<ArvoNone>();
    expectTypeOf(inferredTypes.hooks).toEqualTypeOf<ArvoNone>();
  });

  it('accepts a witness naming neither', () => {
    const inferredTypes = inferSupplied({ types: {} });
    expectTypeOf(inferredTypes.dependencies).toEqualTypeOf<ArvoNone>();
  });
});

describe('what declaring nothing means at the point of use', () => {
  it('has nothing to reach for', () => {
    expectTypeOf<ArvoNone>().toEqualTypeOf<Record<never, never>>();
  });

  it('is not an index signature, so a wrong reach is an error here', () => {
    expectTypeOf<ArvoNone>().not.toEqualTypeOf<Record<string, never>>();
  });
});
