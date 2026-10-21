import type {
  ArvoDependencyScope,
  IArvoEventHandlerDependency,
} from '../../src/ArvoEventHandler/types/dependency.js';
import type { ArvoDependencies } from '../../src/ArvoEventHandler/types/supplied.js';

/**
 * Dependencies for a spec that is not about dependencies.
 *
 * Most of this suite passes something on `dependencies` because the
 * executor it is testing reaches for it, not because the lifetime is
 * what is under test. These are the two shapes those specs want, so
 * they do not each grow a class.
 *
 * Both are conformant, and `dependency.spec.ts` proves it — every spec
 * that uses one of these rests on that being true.
 */

/** What one of these recorded, for a spec that wants to look. */
export type DependencyCalls<TAttributes> = {
  /** Every scope `open` was given, in order. */
  readonly opened: ArvoDependencyScope[];
  /** Every scope `close` was given, in order. */
  readonly closed: ArvoDependencyScope[];
  /** What each `open` produced. */
  readonly built: TAttributes[];
};

/** A dependency and what it recorded. */
export type WatchedDependency<TAttributes extends ArvoDependencies> = {
  readonly dependency: IArvoEventHandlerDependency<TAttributes>;
  readonly calls: DependencyCalls<TAttributes>;
};

/**
 * One value, handed over as it stands.
 *
 * For a dependency that holds nothing and needs no lifetime — a
 * configuration object, a set of constants. Opening and closing it do
 * nothing, which is the ordinary case for such a thing.
 *
 * @param attributes - What the executor will find.
 */
export const heldDependencies = <TAttributes extends ArvoDependencies>(
  attributes: TAttributes,
): WatchedDependency<TAttributes> => {
  const calls: DependencyCalls<TAttributes> = {
    opened: [],
    closed: [],
    built: [],
  };

  return {
    calls,
    dependency: {
      open: (scope: ArvoDependencyScope) => {
        calls.opened.push(scope);
        calls.built.push(attributes);
      },
      close: (scope: ArvoDependencyScope) => {
        calls.closed.push(scope);
      },
      get attributes() {
        return attributes;
      },
    },
  };
};

/**
 * A value built on every open, and let go of on every close.
 *
 * For a dependency that does hold something. `build` stands in for
 * taking a connection, and reading `attributes` before an open throws,
 * exactly as a real one would.
 *
 * @param build - Called on open, given the scope.
 */
export const openedPerExecution = <TAttributes extends ArvoDependencies>(
  build: (scope: ArvoDependencyScope) => TAttributes,
): WatchedDependency<TAttributes> => {
  const calls: DependencyCalls<TAttributes> = {
    opened: [],
    closed: [],
    built: [],
  };
  let held: TAttributes | null = null;

  return {
    calls,
    dependency: {
      open: (scope: ArvoDependencyScope) => {
        calls.opened.push(scope);
        // idempotent: a second open holds what the first built
        held ??= build(scope);
        calls.built.push(held);
      },
      close: (scope: ArvoDependencyScope) => {
        calls.closed.push(scope);
        held = null;
      },
      get attributes(): TAttributes {
        if (held === null) {
          throw new Error('these dependencies have not been opened');
        }
        return held;
      },
    },
  };
};

/**
 * A dependency that opens but cannot be let go of.
 *
 * Deliberately not conformant: a close that raises is the whole point
 * of it. For proving what such a failure costs an execution, which is
 * nothing — the protocol records it and carries on, a connection that
 * would not go back being no reason to tell a caller its work failed.
 *
 * @param attributes - What the executor will find.
 * @param thrownOnClose - What closing it raises.
 */
export const failingToClose = <TAttributes extends ArvoDependencies>(
  attributes: TAttributes,
  thrownOnClose: unknown,
): WatchedDependency<TAttributes> => {
  const held = heldDependencies(attributes);

  return {
    calls: held.calls,
    dependency: {
      open: held.dependency.open,
      close: async (scope: ArvoDependencyScope) => {
        // awaited before the throw, so the recorded close cannot be
        // outrun by the failure it is supposed to precede
        await held.dependency.close(scope);
        throw thrownOnClose;
      },
      get attributes() {
        return held.dependency.attributes;
      },
    },
  };
};
