/** Where an outbox is in its life, and what it holds while open. */
type OutboxPhase<Held> =
  | { readonly name: 'unopened' }
  | { readonly name: 'open'; readonly held: Held }
  | { readonly name: 'closed' };

/**
 * An outbox's life: unopened, then open holding what it acquired, then
 * closed for good. What is held can be reached only while open, so an
 * outbox never touches a connection or a store it has not acquired or has
 * already released.
 */
export class OutboxLifecycle<Held> {
  private phase: OutboxPhase<Held> = { name: 'unopened' };

  /** @param outboxName - How the outbox is named in what it throws. */
  constructor(private readonly outboxName: string) {}

  /** Acquires what the outbox holds, once; a failed acquiring leaves it unopened. */
  open(acquire: () => Held): void {
    if (this.phase.name === 'open') return;
    if (this.phase.name === 'closed') throw this.closedError();
    this.phase = { name: 'open', held: acquire() };
  }

  /** Releases what the outbox holds, once, and leaves it closed whatever releasing does. */
  close(release: (held: Held) => void): void {
    const phaseBeforeClosing = this.phase;
    this.phase = { name: 'closed' };
    if (phaseBeforeClosing.name === 'open') release(phaseBeforeClosing.held);
  }

  /** What the outbox holds, for `operationName`, refusing outside the open phase. */
  held(operationName: string): Held {
    if (this.phase.name === 'open') return this.phase.held;
    if (this.phase.name === 'closed') throw this.closedError();
    throw new Error(
      `${this.outboxName} is not open; call open() before ${operationName}.`,
    );
  }

  private closedError(): Error {
    return new Error(
      `${this.outboxName} is closed; build a new one to use it again.`,
    );
  }
}
