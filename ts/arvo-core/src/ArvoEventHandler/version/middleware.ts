import type { PromiseAble } from '../../types.js';
import type { ArvoExecutionContextTelemetry } from '../context/telemetry/index.js';
import { describeUnlikeLayer } from '../helpers/check-middleware.js';
import type { ArvoExecutorEmission } from '../types/execute.js';
import type {
  ArvoEventHandlerMiddlewareEntry,
  IArvoEventHandlerMiddleware,
} from '../types/middleware.js';
import { markStage } from './telemetry.js';
import type { ArvoExecutorRun, ArvoGateRefusal } from './types.js';

/**
 * Running the layers around a version's executor.
 *
 * Before parts in order, then the executor, then after parts in reverse.
 * A before part that fails stops everything after it, exactly as the
 * executor failing would. An after part runs only where the executor
 * returned, and one that fails is marked on the span and passed over:
 * what the executor returned stands. Nothing a layer returns is read.
 *
 * See `docs/adr/016-executor-middleware.md`.
 */

/**
 * How far one run of the chain has got, shared with whatever is timing it.
 *
 * Mutable on purpose: the clock and the chain run side by side, and each
 * needs to see what the other has done. Once `abandoned` is set, nothing
 * further runs and nothing further is recorded.
 */
export type ArvoMiddlewareProgress = {
  /** The clock fired: run nothing further, record nothing further. */
  abandoned: boolean;
  /** When the executor was entered, or `null` where it has not been. */
  executorStartedAt: number | null;
  /** When the executor returned, or `null` where it has not. */
  returnedAt: number | null;
  /** What it returned. Meaningful only once `returnedAt` is set. */
  returned: ArvoExecutorEmission;
};

/** A run of the chain that has not started. */
export const createArvoMiddlewareProgress = (): ArvoMiddlewareProgress => ({
  abandoned: false,
  executorStartedAt: null,
  returnedAt: null,
  returned: undefined,
});

/** What a failure is, for a span attribute. */
const describeRaised = (raised: unknown) =>
  raised instanceof Error
    ? { 'error.name': raised.name, 'error.message': raised.message }
    : { 'error.name': typeof raised, 'error.message': String(raised) };

/**
 * Every layer an execution will run, in the order it will run them, or
 * why it cannot.
 *
 * Supplied layers come before declared ones. A way to make one is called
 * once, here, and what it returns takes its place. Read before any layer
 * runs, so a refusal leaves nothing half-done.
 *
 * @param supplied - The layers this execution was given, or `null`.
 * @param declared - The layers the handler declared, or `null`.
 * @returns The layers, `null` where neither site named any, or the
 * refusal: `middleware_instantiation_failed` where an entry yields no
 * layer, `middleware_conflict` where two share an identifier.
 */
export const resolveMiddleware = async (
  supplied: readonly ArvoEventHandlerMiddlewareEntry[] | null,
  declared: readonly ArvoEventHandlerMiddlewareEntry[] | null,
): Promise<readonly IArvoEventHandlerMiddleware[] | ArvoGateRefusal | null> => {
  if (supplied !== null && supplied !== undefined && !Array.isArray(supplied)) {
    return {
      faultKind: 'middleware_instantiation_failed',
      message:
        'the layers supplied with this execution are not a list of layers, or ways to make one. No layer ran',
      violations: ['supplied middleware: must be a list'],
    };
  }

  const listed = [
    ...(supplied ?? []).map((entry, index) => ({
      entry,
      at: `supplied middleware[${index}]`,
    })),
    ...(declared ?? []).map((entry, index) => ({
      entry,
      at: `declared middleware[${index}]`,
    })),
  ];

  if (listed.length === 0) return null;

  const layers: IArvoEventHandlerMiddleware[] = [];
  const firstAt = new Map<string, string>();

  for (const { entry, at } of listed) {
    let offered: unknown = entry;
    if (typeof entry === 'function') {
      try {
        offered = await entry();
      } catch (raised) {
        const cause = raised instanceof Error ? raised.message : String(raised);
        return {
          faultKind: 'middleware_instantiation_failed',
          message: `${at} is a way to make a layer, and calling it failed: ${cause}. No layer ran`,
          cause,
          violations: [`${at}: ${cause}`],
        };
      }
    }

    const unlike = describeUnlikeLayer(offered, at);
    if (unlike.length > 0) {
      return {
        faultKind: 'middleware_instantiation_failed',
        message: `${at} did not yield a layer: ${unlike.map((issue) => issue.toString()).join('; ')}. No layer ran`,
        violations: unlike.map((issue) => issue.toString()),
      };
    }

    const layer = offered as IArvoEventHandlerMiddleware;
    const already = firstAt.get(layer.id);
    if (already !== undefined) {
      return {
        faultKind: 'middleware_conflict',
        message: `two layers in this execution carry the identifier "${layer.id}" — ${already} and ${at} — and identifiers must be unique. No layer ran`,
        violations: [`${at}.id: repeats "${layer.id}" from ${already}`],
      };
    }
    firstAt.set(layer.id, at);
    layers.push(layer);
  }

  return layers;
};

/**
 * Runs the layers and the executor between them, and says how it ended.
 *
 * @param param.layers - In the order their before parts run, or `null`.
 * @param param.ctx - Handed to every part and to the executor, unchanged.
 * @param param.executor - The version's own business code.
 * @param param.telemetry - Where each part is marked.
 * @param param.progress - Shared with whatever times this run.
 * @returns How the executor's entry ended, exactly as the executor alone
 * would report it: `returned` or `raised`. `outran` is never reported
 * here; that is the clock's to say.
 */
export const runMiddleware = async <TContext>(param: {
  layers: readonly IArvoEventHandlerMiddleware[] | null;
  ctx: TContext;
  executor: (ctx: TContext) => PromiseAble<ArvoExecutorEmission>;
  telemetry: ArvoExecutionContextTelemetry;
  progress: ArvoMiddlewareProgress;
}): Promise<ArvoExecutorRun> => {
  const { ctx, telemetry, progress } = param;
  const layers = param.layers ?? [];

  try {
    for (const layer of layers) {
      if (progress.abandoned) return { kind: 'raised', raised: undefined };
      if (layer.before === undefined) continue;
      markStage(telemetry, 'middleware_before_entered', {
        'middleware.id': layer.id,
      });
      await layer.before(ctx as never);
      markStage(telemetry, 'middleware_before_returned', {
        'middleware.id': layer.id,
      });
    }

    if (progress.abandoned) return { kind: 'raised', raised: undefined };
    progress.executorStartedAt = Date.now();
    const returned = await param.executor(ctx);
    progress.returnedAt = Date.now();
    progress.returned = returned;
  } catch (raised) {
    return { kind: 'raised', raised };
  }

  const emission: Readonly<ArvoExecutorEmission> = Array.isArray(
    progress.returned,
  )
    ? Object.freeze(progress.returned)
    : progress.returned;

  for (const layer of [...layers].reverse()) {
    if (progress.abandoned) break;
    if (layer.after === undefined) continue;
    markStage(telemetry, 'middleware_after_entered', {
      'middleware.id': layer.id,
    });
    try {
      await layer.after(ctx as never, emission);
      if (!progress.abandoned) {
        markStage(telemetry, 'middleware_after_returned', {
          'middleware.id': layer.id,
        });
      }
    } catch (raised) {
      // An outcome already decided is not undone by what follows it.
      if (!progress.abandoned) {
        markStage(telemetry, 'middleware_after_failed', {
          'middleware.id': layer.id,
          ...describeRaised(raised),
        });
      }
    }
  }

  return { kind: 'returned', returned: progress.returned };
};
