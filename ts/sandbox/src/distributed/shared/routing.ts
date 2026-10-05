import { type ArvoEvent, deriveArvoExecutionId } from 'arvo-core';
import { HANDLERS, type RoutableHandler } from '../handler/index.js';

/**
 * Where one event goes, decided the same way whichever mechanism asks.
 *
 * ADR-006 gives routing to the mechanism and gives it nothing to go on
 * but the event, which is deliberate: an event that could only be routed
 * by consulting a record could not be routed by a mechanism that had
 * lost the record.
 *
 * **`to` is the destination, and nothing else is.** ADR-001 calls it a
 * hint the application supplies to infrastructure; ADR-006 calls it what
 * Arvo routes on; ADR-010's gate makes it authoritative and refuses an
 * event whose `to` is not the receiving handler's own contract type. One
 * field names the recipient, every layer agrees which, and a mechanism
 * that worked the recipient out from anything else would be inventing a
 * second addressing scheme alongside the one the model has.
 *
 * **`domain` is read first, because it says whether there is a
 * destination here at all.** A non-null domain means the event cannot be
 * fulfilled in this lattice and must be lifted out of it, and `null` —
 * the ordinary case — means it belongs where it is. Where the event is
 * addressed is then somebody else's business.
 *
 * What remains is not a destination but a **role**: whether the event
 * opens an execution of the handler it is addressed to or answers one
 * already under way. That is settled by `type`, because a contract has
 * exactly one type it takes in — so an event of that type opens an
 * execution and an event of any other type that contract knows about
 * answers one. It is the same rule the handler resolves by, which is the
 * point: a mechanism deciding differently would hand a handler events it
 * then refused.
 *
 * `category` is not consulted. It is a statement the sender makes about
 * its own role, and the gate's job is to refuse an event whose sender
 * claimed a role the receiver resolved differently. A mechanism routing
 * on it would be taking the claim for the answer — and would get the
 * first event of every run wrong, since a handler stamps it on
 * everything it builds and a client starting a run has nothing to stamp
 * it from.
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

/**
 * The handler implementing one contract type, or nothing where none does.
 *
 * Given `to` and nothing else, because `to` is the whole of what says
 * where an event is addressed.
 */
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
  // Read before anything else. A domained event cannot be fulfilled in
  // this lattice at all, so where it is addressed is somebody else's
  // business.
  if (event.domain !== null) return { kind: 'left', domain: event.domain };

  const handler = handlerFor(event.to);
  if (handler === null) return { kind: 'outside', addressedTo: event.to };

  // The role, now that the recipient is settled. A contract has one
  // type it takes in, so this is a request rather than an answer.
  //
  // Its execution is derived from the event, because the execution does
  // not exist yet to have an identifier read off it — derived rather
  // than minted, so the same request arriving twice resolves to the
  // execution the first one opened.
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
