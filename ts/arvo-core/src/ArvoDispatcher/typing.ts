import type { ArvoEventHandler } from '../ArvoEventHandler/index.js';
import type { IArvoEventHandlerDependency } from '../ArvoEventHandler/types/dependency.js';

/**
 * Any handler at all, whatever it implements and whatever it declares.
 *
 * `any` stands for "unconstrained" here, not for a value of unchecked type:
 * a handler's dependency and hook types are inputs to it, so a narrower
 * constraint would refuse handlers that declare their own.
 */
export type ArvoAnyEventHandler = ArvoEventHandler<any, any, any, any>;

/** The handlers a list of members holds, in order, a set contributing its own. */
export type HandlersOf<TMembers> = TMembers extends readonly []
  ? []
  : TMembers extends readonly [infer THead, ...infer TRest]
    ? THead extends ArvoAnyEventHandler
      ? [THead, ...HandlersOf<TRest>]
      : THead extends { readonly handlers: infer TInner }
        ? [...HandlersOf<TInner>, ...HandlersOf<TRest>]
        : never
    : // a list whose length is not known: its element, where that is a handler
      TMembers extends readonly (infer TMember)[]
      ? [TMember] extends [ArvoAnyEventHandler]
        ? TMember[]
        : ArvoAnyEventHandler[]
      : [];

/**
 * The dependencies a set can be given: one entry per handler, keyed by the
 * handler's self contract `type`, each typed to what that handler declares.
 */
export type DependenciesOf<THandlers extends readonly ArvoAnyEventHandler[]> = {
  readonly [THandler in THandlers[number] as THandler['contracts']['self']['type']]?: THandler extends ArvoEventHandler<
    any,
    any,
    infer TDependencies,
    any
  >
    ? IArvoEventHandlerDependency<TDependencies>
    : never;
};

type UnionToIntersection<TUnion> = (
  TUnion extends unknown
    ? (member: TUnion) => void
    : never
) extends (member: infer TIntersection) => void
  ? TIntersection
  : never;

/** The hooks a set can be given: one value every handler in it can accept. */
export type HooksOf<THandlers extends readonly ArvoAnyEventHandler[]> =
  UnionToIntersection<
    THandlers[number] extends ArvoEventHandler<any, any, any, infer THooks>
      ? THooks
      : never
  >;
