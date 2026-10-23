import type { Attributes } from '@opentelemetry/api';
import type * as z from 'zod/v4/core';
import type { VersionedArvoContract } from '../../../ArvoContract/versioned/index.js';
import { ErrorIssue } from '../../../utils/error-issue.js';
import { textOfThrown } from '../../../utils/thrown-text.js';
import type { ArvoExecutionContext } from '../../context/index.js';
import { layerShapeIssues } from '../../helpers/check-middleware.js';
import type { ArvoExecutorEmission } from '../../types/execute.js';
import type { IArvoEventHandlerMiddleware } from '../../types/middleware.js';
import type { ArvoServiceMap } from '../../types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
} from '../../types/supplied.js';
import { type ArvoExecutionStage, markStage } from '../telemetry.js';
import { ArvoComposedMiddlewareValidationError } from './errors.js';
import { middlewarePosition } from './position.js';

/** What kind of thing was thrown: an Error's name, else its type. */
const kindOfThrown = (thrown: unknown): string => {
  try {
    return thrown instanceof Error ? String(thrown.name) : typeof thrown;
  } catch {
    return 'Error';
  }
};

/** What was thrown, as span attributes. Never throws itself. */
const describeThrown = (thrown: unknown): Attributes => ({
  'error.name': kindOfThrown(thrown),
  'error.message': textOfThrown(thrown),
});

/**
 * A layer's parts, each read once and checked, held beside the layer they
 * came from so each part is still called on it.
 */
type ArvoCheckedLayer = {
  readonly layer: IArvoEventHandlerMiddleware;
  readonly id: string;
  readonly before: IArvoEventHandlerMiddleware['before'];
  readonly after: IArvoEventHandlerMiddleware['after'];
};

/** Why a shape issue stops the identifier pass. */
const IDENTIFIERS_NOT_COMPARABLE =
  'duplicate ids are checked only once every middleware is valid';

/**
 * The layers of one execution, run as one before and one after.
 *
 * Before parts run in order and the first that throws stops the rest;
 * after parts run in reverse, and one that throws is marked and passed
 * over. Each part is marked on the execution's span by its own layer's
 * identifier, with whether the run clock had fired; the composite itself
 * is never marked. Once the run clock has fired, no further part starts.
 *
 * Internal, and kept so by two rules: it is never exported from the
 * package, and it is never placed in a list of layers. The identifier
 * check runs over the layers it is built from; were a composite ever
 * nested, the layers inside it would escape that check.
 *
 * See `docs/adr/016-executor-middleware.md`.
 */
export class ArvoComposedMiddleware<
  TSelf extends VersionedArvoContract = VersionedArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDataSchema extends z.$ZodObject = z.$ZodObject,
  TDependencies extends ArvoDependencies = ArvoDependencies,
  TMechanismHooks extends ArvoMechanismHooks = ArvoMechanismHooks,
> implements
    IArvoEventHandlerMiddleware<
      'arvo.composed',
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >
{
  readonly id = 'arvo.composed' as const;

  /**
   * The layers, in the order their before parts run, typed as a handler
   * declares them: for any version's context. Each part was read once,
   * when it was checked, and that is the part run.
   */
  readonly #layers: readonly ArvoCheckedLayer[];

  /** Aborted by the version when the run clock fires. */
  readonly #abortSignal: AbortSignal;

  /** How many layers came from each list. */
  readonly #suppliedCount: number;
  readonly #declaredCount: number;

  /**
   * @param param.supplied - The supplied layers, in the order given.
   * @param param.declared - The declared layers, in the order given.
   * @param param.abortSignal - Aborted when the run clock fires.
   * @throws {ArvoComposedMiddlewareValidationError} If the layers break a
   * rule: every entry that is not a layer, or else every repeated
   * identifier, in one refusal.
   */
  constructor(param: {
    supplied: readonly IArvoEventHandlerMiddleware[];
    declared: readonly IArvoEventHandlerMiddleware[];
    abortSignal: AbortSignal;
  }) {
    const positionedEntries = [
      ...param.supplied.map((layer, entryIndex) => ({
        layer,
        position: middlewarePosition('supplied', entryIndex),
      })),
      ...param.declared.map((layer, entryIndex) => ({
        layer,
        position: middlewarePosition('declared', entryIndex),
      })),
    ];

    this.#layers = this.#validate(positionedEntries);
    this.#abortSignal = param.abortSignal;
    this.#suppliedCount = param.supplied.length;
    this.#declaredCount = param.declared.length;
  }

  /**
   * How many layers this execution runs: those supplied with it, those
   * declared on the handler, and both together. A fresh value on each read.
   */
  get count(): { total: number; supplied: number; declared: number } {
    return {
      total: this.#suppliedCount + this.#declaredCount,
      supplied: this.#suppliedCount,
      declared: this.#declaredCount,
    };
  }

  /**
   * Judges the layers in two passes, throwing at the first that fails:
   * every entry must be a layer, then no two may share an identifier.
   *
   * Each layer's parts are read once, here: a part read again later could
   * be something other than what was checked.
   *
   * @param positionedEntries - Every entry, in run order, with where it sits.
   * @returns Every layer with its parts as read and checked.
   * @throws {ArvoComposedMiddlewareValidationError} Naming every entry that
   * is not a layer or cannot be read, or else every repeated identifier.
   */
  #validate(
    positionedEntries: readonly {
      layer: IArvoEventHandlerMiddleware;
      position: string;
    }[],
  ): readonly ArvoCheckedLayer[] {
    // identifiers are compared only once every entry is known to be a layer
    const shapeIssues: ErrorIssue[] = [];
    const checkedLayers: {
      checkedLayer: ArvoCheckedLayer;
      position: string;
    }[] = [];
    // a caller no compiler saw may have handed over anything as a layer
    for (const { layer, position } of positionedEntries) {
      if (typeof layer !== 'object' || layer === null) {
        shapeIssues.push(...layerShapeIssues(layer, position));
        continue;
      }
      let partsAsRead: Omit<ArvoCheckedLayer, 'layer'>;
      try {
        partsAsRead = {
          id: layer.id,
          before: layer.before,
          after: layer.after,
        };
      } catch (error_) {
        shapeIssues.push(
          new ErrorIssue({
            path: position,
            message: `could not be read: ${textOfThrown(error_)}`,
          }),
        );
        continue;
      }
      const partIssues = layerShapeIssues(partsAsRead, position);
      shapeIssues.push(...partIssues);
      if (partIssues.length === 0) {
        checkedLayers.push({
          checkedLayer: { layer, ...partsAsRead },
          position,
        });
      }
    }
    if (shapeIssues.length > 0) {
      throw new ArvoComposedMiddlewareValidationError(
        'middleware_instantiation_failed',
        'This execution was not run: some of its middleware is not a valid middleware. No middleware ran and the handler was not called.',
        shapeIssues.map(
          (issue) =>
            new ErrorIssue({
              path: issue.path,
              message: issue.message,
              received: issue.received,
              blockingReason: IDENTIFIERS_NOT_COMPARABLE,
            }),
        ),
      );
    }

    const conflictIssues: ErrorIssue[] = [];
    const firstPositionById = new Map<string, string>();
    for (const { checkedLayer, position } of checkedLayers) {
      const layerId = checkedLayer.id;
      const earlierPosition = firstPositionById.get(layerId);
      if (earlierPosition === undefined) {
        firstPositionById.set(layerId, position);
        continue;
      }
      conflictIssues.push(
        new ErrorIssue({
          path: `${position}.id`,
          message: `has the id "${layerId}", which ${earlierPosition} already uses. Every middleware in one execution needs its own id: rename one of them`,
        }),
      );
    }
    if (conflictIssues.length > 0) {
      throw new ArvoComposedMiddlewareValidationError(
        'middleware_conflict',
        'This execution was not run: two or more of its middleware share an id. No middleware ran and the handler was not called.',
        conflictIssues,
      );
    }
    return checkedLayers.map(({ checkedLayer }) => checkedLayer);
  }

  /**
   * Runs every before part in order.
   *
   * @param ctx - The context the executor will be given, handed to each
   * part unchanged.
   * @throws What a before part threw, unchanged; no part after it runs.
   */
  async before(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): Promise<void> {
    for (const checkedLayer of this.#layers) {
      if (this.#abortSignal.aborted) return;
      if (checkedLayer.before === undefined) continue;
      this.#markPart(ctx, 'middleware_before_entered', checkedLayer);
      await checkedLayer.before.call(
        checkedLayer.layer,
        this.#contextForLayers(ctx),
      );
      this.#markPart(ctx, 'middleware_before_returned', checkedLayer);
    }
  }

  /**
   * Runs every after part in reverse order. Never throws: a part that
   * throws is marked and passed over, and the remaining parts still run.
   *
   * @param ctx - The context the executor was given.
   * @param emission - What the executor returned, handed over read-only.
   */
  async after(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
    emission: Readonly<ArvoExecutorEmission>,
  ): Promise<void> {
    const readOnlyEmission: Readonly<ArvoExecutorEmission> = Array.isArray(
      emission,
    )
      ? Object.freeze(emission)
      : emission;
    for (const checkedLayer of [...this.#layers].reverse()) {
      if (this.#abortSignal.aborted) return;
      if (checkedLayer.after === undefined) continue;
      this.#markPart(ctx, 'middleware_after_entered', checkedLayer);
      try {
        await checkedLayer.after.call(
          checkedLayer.layer,
          this.#contextForLayers(ctx),
          readOnlyEmission,
        );
        this.#markPart(ctx, 'middleware_after_returned', checkedLayer);
      } catch (error_) {
        // never rethrow: an after part cannot change the outcome
        this.#markPart(
          ctx,
          'middleware_after_failed',
          checkedLayer,
          describeThrown(error_),
        );
      }
    }
  }

  /**
   * This version's context, as the layers are typed to receive it.
   *
   * A layer is typed for every version's context, this one for its own
   * state schema, and `setState` makes neither assignable to the other.
   * Safe because what a layer writes through `setState` is still checked
   * against this version's schema.
   */
  #contextForLayers(
    ctx: ArvoExecutionContext<
      TSelf,
      TServices,
      TDataSchema,
      TDependencies,
      TMechanismHooks
    >,
  ): ArvoExecutionContext {
    return ctx as unknown as ArvoExecutionContext;
  }

  /** Marks one part of one layer, with whether the run clock had fired. */
  #markPart(
    ctx: { telemetry: ArvoExecutionContext['telemetry'] },
    stage: ArvoExecutionStage,
    layer: { id: string },
    thrownAttributes: Attributes = {},
  ): void {
    markStage(ctx.telemetry, stage, {
      'middleware.id': layer.id,
      'middleware.aborted': this.#abortSignal.aborted,
      ...thrownAttributes,
    });
  }
}
