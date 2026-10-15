import { context as activeContext, createContextKey } from '@opentelemetry/api';

/**
 * Which delivery a log line belongs to, carried alongside the work.
 *
 * A trace already links a log record to the span it was emitted under,
 * and the span carries the execution's identity. That is enough to
 * follow one execution if you start from the trace — and not enough to
 * ask the opposite question, which is the one an operator actually
 * asks: *show me every line for this workflow*. A log store cannot join
 * to a trace store.
 *
 * So the identity goes on the line as well as on the span. Not instead:
 * both, because they answer different questions and the duplication
 * costs a few bytes per record.
 *
 * Carried in OpenTelemetry's own context rather than in a variable of
 * this module's, so it follows the work across every `await` without
 * anything passing it along by hand — and so two deliveries in flight at
 * once cannot read each other's.
 *
 * It lives beside the handlers rather than under `shared/` because the
 * logger that reads it does, and nothing under `handler/` may reach
 * outwards — that rule is what keeps the handlers the constant of this
 * exercise. A mechanism setting this is reaching inwards, which is the
 * direction that is allowed.
 */

/** What a log line says about the delivery it belongs to. */
export type DeliveryIdentity = {
  /** The workflow, which is what an operator searches by. */
  readonly subject: string;
  /** The handler whose contract the event is addressed to. */
  readonly handler: string;
  /** The event that caused this delivery. */
  readonly triggeringEventId: string;
  /** Which attempt this is, counting from 0 as Arvo counts. */
  readonly attempt: number;
};

const DELIVERY = createContextKey('arvo.delivery');

/**
 * Runs `work` with this delivery's identity on every line it logs.
 *
 * @param identity - What to stamp.
 * @param work - The delivery.
 */
export const withDeliveryIdentity = <TResult>(
  identity: DeliveryIdentity,
  work: () => Promise<TResult>,
): Promise<TResult> =>
  activeContext.with(activeContext.active().setValue(DELIVERY, identity), work);

/** This delivery's identity, or `null` outside one. */
export const currentDeliveryIdentity = (): DeliveryIdentity | null =>
  (activeContext.active().getValue(DELIVERY) as DeliveryIdentity | undefined) ??
  null;

/**
 * This delivery's identity as log attributes, or nothing outside one.
 *
 * Prefixed, so a line's own fields and the delivery it belongs to cannot
 * collide — a handler logging `attempt` means its own thing by it.
 */
export const deliveryLogAttributes = (): Record<string, string | number> => {
  const identity = currentDeliveryIdentity();
  if (identity === null) return {};

  return {
    'arvo.subject': identity.subject,
    'arvo.handler': identity.handler,
    'arvo.triggering_event.id': identity.triggeringEventId,
    'arvo.attempt': identity.attempt,
  };
};
