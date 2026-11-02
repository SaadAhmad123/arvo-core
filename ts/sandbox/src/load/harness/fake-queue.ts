import type { ArvoEvent } from 'arvo-core';

/**
 * A queue in this process: what the workers take from and what publishing
 * puts on. It keeps nothing it accepted from being taken again by mistake,
 * but may hand an event out twice on purpose, as a real queue redelivers.
 */

/** One delivery off the queue. */
export type QueuedDelivery = {
  readonly event: ArvoEvent;
  readonly attempt: number;
};

export class FakeQueue {
  readonly #waiting: QueuedDelivery[] = [];
  #publishedCount = 0;

  /** Every event put on the queue so far, repeats included. */
  get publishedCount(): number {
    return this.#publishedCount;
  }

  /** How many deliveries are waiting to be taken. */
  get waitingCount(): number {
    return this.#waiting.length;
  }

  /** Puts events on the queue, each to be delivered for the first time. */
  publish(events: readonly ArvoEvent[]): void {
    this.#publishedCount += events.length;
    for (const event of events) this.#waiting.push({ event, attempt: 0 });
  }

  /** Puts a delivery back to be tried again. */
  redeliver(delivery: QueuedDelivery): void {
    this.#waiting.push(delivery);
  }

  /** The next delivery, or none where nothing waits. */
  take(): QueuedDelivery | undefined {
    return this.#waiting.shift();
  }
}
