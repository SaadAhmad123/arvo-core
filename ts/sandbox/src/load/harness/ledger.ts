import type { ArvoOutboxDriver } from 'arvo-core';

/**
 * What every committing check writes down as it goes and verifies at its
 * end: nothing committed is lost, no revision lands twice, payloads come
 * back as committed, listings come oldest first, and nothing that should
 * have answered threw.
 */
export class Ledger {
  readonly committedEventIds = new Set<string>();
  readonly handedOutEventIds = new Set<string>();
  readonly #commitCountByRevision = new Map<string, number>();
  readonly #sampledPayloadById = new Map<
    string,
    {
      readonly eventId: string;
      readonly triggeringEventId: string;
      readonly payload: string;
    }
  >();
  readonly unexpectedThrows: string[] = [];
  readonly outOfOrderListings: string[] = [];

  /** Records a commit that landed: the revision, and every event it carried. */
  recordCommit(param: {
    readonly executionId: string | null;
    readonly casVersion: number | null;
    readonly eventIds: readonly string[];
  }): void {
    if (param.executionId !== null && param.casVersion !== null) {
      const revisionKey = `${param.executionId}@${param.casVersion}`;
      this.#commitCountByRevision.set(
        revisionKey,
        (this.#commitCountByRevision.get(revisionKey) ?? 0) + 1,
      );
    }
    for (const eventId of param.eventIds) this.committedEventIds.add(eventId);
  }

  /** Records events handed to the queue, by the fast path, the sweeper or a recovery. */
  recordHandedOut(eventIds: Iterable<string>): void {
    for (const eventId of eventIds) this.handedOutEventIds.add(eventId);
  }

  /** Keeps one event's payload as the outbox first gave it, to compare at the end. */
  samplePayload(param: {
    readonly eventId: string;
    readonly triggeringEventId: string;
    readonly payload: string;
  }): void {
    if (this.#sampledPayloadById.size >= 500) return;
    this.#sampledPayloadById.set(param.eventId, param);
  }

  /** Records a listing whose landing times went backwards. */
  recordListing(committedAts: readonly string[]): void {
    for (let position = 1; position < committedAts.length; position += 1) {
      const earlier = committedAts[position - 1] ?? '';
      const later = committedAts[position] ?? '';
      if (later < earlier) {
        this.outOfOrderListings.push(`${earlier} listed before ${later}`);
      }
    }
  }

  /** Records something that threw where it should have answered. */
  recordUnexpectedThrow(where: string, error_: unknown): void {
    this.unexpectedThrows.push(
      `${where}: ${error_ instanceof Error ? error_.message : String(error_)}`,
    );
  }

  /** Every problem found, each naming the event or revision; none where everything held. */
  async problems(driver: ArvoOutboxDriver): Promise<string[]> {
    const problems: string[] = [];
    for (const eventId of this.committedEventIds) {
      if (!this.handedOutEventIds.has(eventId)) {
        problems.push(`event ${eventId} was committed and never handed out`);
      }
    }
    for (const [revisionKey, commitCount] of this.#commitCountByRevision) {
      if (commitCount > 1) {
        problems.push(`revision ${revisionKey} landed ${commitCount} times`);
      }
    }
    for (const sampled of this.#sampledPayloadById.values()) {
      const entries = await driver.readCommittedEvents({
        filter: { triggeringEventId: sampled.triggeringEventId },
        restoreEvents: false,
      });
      const stored = entries.find(
        (entry) => entry.record.id === sampled.eventId,
      );
      // deleted by retention is allowed; changed is not
      if (stored !== undefined && stored.record.payload !== sampled.payload) {
        problems.push(
          `event ${sampled.eventId}'s payload changed after it was committed`,
        );
      }
    }
    problems.push(
      ...this.outOfOrderListings.map((listing) => `out of order: ${listing}`),
      ...this.unexpectedThrows.map((thrown) => `threw: ${thrown}`),
    );
    return problems;
  }
}
