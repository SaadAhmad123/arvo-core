import type { ArvoEventHandlerExecuteParam } from '../ArvoEventHandler/types/execute.js';
import type { ArvoEventHandlerMiddlewareEntry } from '../ArvoEventHandler/types/middleware.js';
import type { ArvoNone } from '../ArvoEventHandler/types/supplied.js';
import type { ArvoAnyEventHandler, DependenciesOf, HooksOf } from './typing.js';

/** A dispatcher as another dispatcher reads it: its handlers and its layers, each already flat. */
export type ArvoDispatcherSet = {
  readonly handlers: readonly ArvoAnyEventHandler[];
  readonly middlewares: readonly ArvoEventHandlerMiddlewareEntry[];
};

/** An entry a dispatcher's handler list may hold: a handler, or a dispatcher whose handlers are taken. */
export type ArvoDispatcherMember = ArvoAnyEventHandler | ArvoDispatcherSet;

/** An entry a dispatcher's layer list may hold: a layer, or a dispatcher whose layers are taken. */
export type ArvoDispatcherMiddlewareMember =
  | ArvoEventHandlerMiddlewareEntry
  | ArvoDispatcherSet;

/**
 * How a dispatcher is declared.
 *
 * Refused, every rule broken named at once, where the handlers flatten to an
 * empty set, one handler appears twice, two handlers' self contracts share a
 * `type`, or one handler declares a service another implements at a version
 * or `uri` the implementer does not declare. Nothing about the layers is
 * judged here; a handler refuses a defect in them when entered.
 */
export type ArvoDispatcherOptions<
  TMembers extends
    readonly ArvoDispatcherMember[] = readonly ArvoDispatcherMember[],
> = {
  /** The handlers, or dispatchers whose handlers are taken, in order. */
  handlers: TMembers;
  /**
   * Layers supplied to every handler on every call, as its supplied layers,
   * or dispatchers whose layers are taken at that position. Omit for none.
   */
  middlewares?: readonly ArvoDispatcherMiddlewareMember[];
};

/**
 * What a dispatcher is entered with: what a handler is entered with, less
 * layers. `dependencies` holds one entry per handler, keyed by its self
 * contract `type`; `hooks` is one value every handler can accept.
 *
 * `telemetry` is resolved once, when the call begins, as a handler resolves
 * it: as given, or otherwise the default. The dispatcher records with it and
 * always enters the handler with that same resolved telemetry, so the handler
 * takes no default of its own. Nothing is kept for the next call.
 *
 * @example
 * ```typescript
 * const param: ArvoDispatcherExecuteParam<typeof handlers> = {
 *   event,
 *   state,
 *   attempt: 0,
 *   telemetry: { tracer, logger },
 * };
 * ```
 */
export type ArvoDispatcherExecuteParam<
  THandlers extends
    readonly ArvoAnyEventHandler[] = readonly ArvoAnyEventHandler[],
> = Pick<
  ArvoEventHandlerExecuteParam<ArvoNone, ArvoNone>,
  'event' | 'state' | 'attempt' | 'telemetry'
> & {
  dependencies?: DependenciesOf<THandlers>;
  hooks?: HooksOf<THandlers>;
};
