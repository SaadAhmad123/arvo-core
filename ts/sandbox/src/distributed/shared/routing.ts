import { type ArvoEvent, deriveArvoExecutionId } from 'arvo-core';
import { HANDLERS, type RoutableHandler } from '../handler/index.js';

/**
 * Where one event goes, decided the same way whichever mechanism asks.
 *
 * ADR-006 gives routing to the mechanism and gives it nothing else to go
 * on but the event, which is deliberate: an event that could only be
 * routed by consulting a record could not be routed by a mechanism that
 * had lost the record. Everything needed is on the event — its `domain`
 * says whether anything here may carry it, its `to` says whose work it
 * is, and its `type` says whether it opens an execution or answers one.
 *
 * The last of those is worth saying plainly, because the obvious answer
 * is wrong. An event's `category` states whether it opens or completes,
 * and routing on it fails: a handler sets it on everything it builds,
 * and a client building the event that starts a run does not. A
 * mechanism keying on it would route the first event of every run as an
 * answer to an execution that does not exist.
 *
 * What always holds is the type. A contract has exactly one type it
 * takes in, so an event of that type opens an execution of it and an
 * event of any other type the contract knows about answers one. That is
 * the same rule the handler itself resolves by, which is the point:
 * a mechanism that decided differently would hand events to a handler
 * that then refused them.
 *
 * Shared between the mechanisms on purpose. Two of them deciding
 * differently where an event goes would be two different exercises, and
 * the difference between them is meant to be how they carry an event
 * rather than where they think it is going.
 */

/** Where an event goes, and what a mechanism has to do to get it there. */
export type Destination =
  /** It opens an execution, which is this one, under this handler. */
  | {
      readonly kind: 'opens';
      readonly executionId: string;
      readonly handler: RoutableHandler;
      /**
       * What the event says is awaiting its answer.
       *
       * The asking execution, where a handler built the request. An
       * event that opens a run was built by a client and names whatever
       * the client named, so this says who is waiting only as far as
       * the event does.
       */
      readonly awaitingExecutionId: string;
    }
  /** It answers an execution already under way, which is this one. */
  | {
      readonly kind: 'answers';
      readonly executionId: string;
      readonly handler: RoutableHandler;
    }
  /**
   * It carries a domain, so it leaves the lattice.
   *
   * Nothing a mechanism runs may answer it. The execution that asked
   * rests at `waiting` until something outside does, which is what
   * waiting means.
   */
  | { readonly kind: 'left'; readonly domain: string }
  /**
   * Nothing here implements what it is addressed to.
   *
   * Ordinary rather than wrong: a run's final answer is addressed to
   * whoever asked for the run, and that is not a handler. A mechanism
   * puts it where its caller can find it.
   */
  | { readonly kind: 'outside'; readonly addressedTo: string | null };

/** The handler implementing one contract type, or nothing where none does. */
export const handlerFor = (type: string | null): RoutableHandler | null => {
  if (type === null) return null;
  // Own properties only. A `to` of `__proto__` finds something on every
  // object, and the something it finds is not a handler.
  return Object.hasOwn(HANDLERS, type)
    ? ((HANDLERS as Record<string, RoutableHandler>)[type] ?? null)
    : null;
};

/**
 * Where one event goes.
 *
 * @param event - The event to route, as it was committed.
 * @returns What a mechanism has to do with it, in the one form both
 * mechanisms act on.
 */
export const destinationFor = async (
  event: ArvoEvent,
): Promise<Destination> => {
  // Read before anything else. A domained event leaves whatever is
  // carrying it, and where it was addressed is then somebody else's
  // business.
  if (event.domain !== null) return { kind: 'left', domain: event.domain };

  const handler = handlerFor(event.to);
  if (handler === null) return { kind: 'outside', addressedTo: event.to };

  // An opening event's execution is derived from the event, because the
  // execution does not exist yet to have an identifier read off it.
  // Derived rather than minted, so the same event arriving twice
  // resolves to the execution the first one opened.
  if (event.type === handler.contracts.self.type) {
    return {
      kind: 'opens',
      executionId: await deriveArvoExecutionId(event),
      handler,
      awaitingExecutionId: event.executionid,
    };
  }

  // Anything else answers an execution, and the event says which. A
  // reply carries the asking execution's identifier rather than its
  // own, which is what lets an answer be routed without reading a
  // record.
  return { kind: 'answers', executionId: event.executionid, handler };
};
