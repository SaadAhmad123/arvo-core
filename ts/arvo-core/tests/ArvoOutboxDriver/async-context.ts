import { createRequire } from 'node:module';
import type { ContextAPI, Span, TraceAPI } from '@opentelemetry/api';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';

/**
 * OpenTelemetry's own context manager, registered through `require` as an
 * application's SDK registers one, so a test can ask whether a span
 * continued the trace active where it was started. See
 * `tests/recording-provider.ts` for why registration goes through `require`.
 */

const requiredApi: { context: ContextAPI; trace: TraceAPI } = createRequire(
  import.meta.url,
)('@opentelemetry/api');

/** Registers a context manager that carries the active span across awaits. */
export const registerAsyncContextManager = () => {
  requiredApi.context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
};

/** Undoes the registration, so one test's context never reaches another. */
export const unregisterAsyncContextManager = () => {
  requiredApi.context.disable();
};

/** Runs `run` with `parentSpan` active, as code inside that span would. */
export const withActiveSpan = <Answer>(
  parentSpan: Span,
  run: () => Answer,
): Answer =>
  requiredApi.context.with(
    requiredApi.trace.setSpan(requiredApi.context.active(), parentSpan),
    run,
  );
