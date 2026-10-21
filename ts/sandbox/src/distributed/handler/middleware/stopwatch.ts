import type {
  ArvoExecutionContext,
  IArvoEventHandlerMiddleware,
} from 'arvo-core';

/**
 * How long an executor took, measured around it.
 *
 * Listed as a way to make one, so each execution gets its own instance
 * and the start time can live on it — which is the one thing a layer
 * made per execution may do that a shared one may not.
 */
export class Stopwatch implements IArvoEventHandlerMiddleware<'stopwatch'> {
  readonly id = 'stopwatch' as const;

  #startedAt = 0;

  before(): void {
    this.#startedAt = performance.now();
  }

  after(ctx: ArvoExecutionContext): void {
    ctx.telemetry.metric.record(
      'handler.timed',
      performance.now() - this.#startedAt,
      { 'contract.type': ctx.contracts.self.type },
    );
  }
}
