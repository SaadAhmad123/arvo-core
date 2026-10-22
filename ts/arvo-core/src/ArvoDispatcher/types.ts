import type { Meter, Tracer } from '@opentelemetry/api';
import type { ArvoLogger } from '../ArvoEventHandler/context/telemetry/types.js';
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
  /** Where the dispatcher's own span, counter and log are written. */
  telemetry?: {
    tracer?: Tracer;
    meter?: Meter | null;
    logger?: ArvoLogger | null;
  };
};

/**
 * What a dispatcher is entered with: what a handler is entered with, less
 * layers. `dependencies` holds one entry per handler, keyed by its self
 * contract `type`; `hooks` is one value every handler can accept.
 */
export type ArvoDispatcherExecuteParam<
  THandlers extends
    readonly ArvoAnyEventHandler[] = readonly ArvoAnyEventHandler[],
> = Pick<
  ArvoEventHandlerExecuteParam<ArvoNone, ArvoNone>,
  'event' | 'state' | 'attempt'
> & {
  dependencies?: DependenciesOf<THandlers>;
  hooks?: HooksOf<THandlers>;
};
