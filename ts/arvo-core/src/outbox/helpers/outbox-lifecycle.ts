/** Where an outbox is in its life, and the resources it holds while open. */
type OutboxPhase<Resources> =
  | { readonly name: 'unopened' }
  | { readonly name: 'open'; readonly resources: Resources }
  | { readonly name: 'closed' };

/**
 * An outbox's life: unopened, then open holding the resources it acquired,
 * then closed for good. Its resources can be reached only while open, so an
 * outbox never touches a connection or a store it has not acquired or has
 * already released.
 */
export class OutboxLifecycle<Resources> {
  private phase: OutboxPhase<Resources> = { name: 'unopened' };

  /** @param outboxName - How the outbox is named in what it throws. */
  constructor(private readonly outboxName: string) {}

  /** Acquires the outbox's resources, once; a failed acquiring leaves it unopened. */
  open(acquire: () => Resources): void {
    if (this.phase.name === 'open') return;
    if (this.phase.name === 'closed') throw this.closedError();
    this.phase = { name: 'open', resources: acquire() };
  }

  /** Releases the outbox's resources, once, and leaves it closed whatever releasing does. */
  close(release: (resources: Resources) => void): void {
    const phaseBeforeClosing = this.phase;
    this.phase = { name: 'closed' };
    if (phaseBeforeClosing.name === 'open')
      release(phaseBeforeClosing.resources);
  }

  /** The outbox's resources, for `operationName`, refusing outside the open phase. */
  resourcesFor(operationName: string): Resources {
    if (this.phase.name === 'open') return this.phase.resources;
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
