import { okAsync, ResultAsync } from 'neverthrow';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { fromNeverthrowAsync } from '../result.js';
import type { AsyncResult } from '../types.js';
import { ArvoToCloudEventConverter } from './default/index.js';
import { CloudEventTransformationError } from './errors.js';
import type {
  IArvoEventTransformer,
  ICloudEventConverter,
} from './interface.js';
import type { CloudEvent, ForeignCloudEventFallback } from './types.js';

/**
 * Every stage's `convert`/`revert`, viewed uniformly as `unknown -> unknown`.
 * `transformer` and each entry of `converters` are genuinely
 * different-shaped contracts — TypeScript has no way to track that chain of
 * types through a dynamic-length array at compile time. This module's own
 * public methods stay precisely typed; only this internal loop drops to
 * `unknown`, the same trade-off any pipeline runner over a heterogeneous
 * stage list makes.
 */
type AnyStage = {
  convert(data: unknown): Promise<unknown>;
  revert(data: unknown): Promise<unknown>;
};

/** `transformer.revert`, viewed with the `foreignFallback` no `ICloudEventConverter` understands or needs. */
type TransformerRevert = (
  data: unknown,
  foreignFallback?: ForeignCloudEventFallback,
) => Promise<unknown>;

/**
 * A stage's own thrown value is preserved verbatim as `cause` — unless it
 * is already a {@link CloudEventTransformationError}, in which case it is
 * passed through unchanged rather than double-wrapped. `transformer`'s own
 * `revert` throws exactly this shape for a structural rejection; only a
 * genuinely unexpected throw (a consumer-appended stage's own failure, or a
 * bug) becomes a `'stage'` failure.
 */
const toStageError = (
  cause: unknown,
  direction: 'convert' | 'revert',
  stageIndex: number,
): CloudEventTransformationError =>
  cause instanceof CloudEventTransformationError
    ? cause
    : new CloudEventTransformationError({
        kind: 'stage',
        direction,
        stageIndex,
        cause,
      });

/**
 * Transforms between {@link ArvoEvent} and CloudEvent.
 *
 * `new CloudEventConverter()` with no arguments is what most consumers
 * want: it converts and reverts using the standard ArvoEvent↔CloudEvent
 * mapping alone. If you need to enrich the produced CloudEvent — attach a
 * schema-registry reference, a routing header, or any other
 * CloudEvent-to-CloudEvent transformation — supply your own `converters`;
 * each one runs forward on `convert`/`tryConvert` and unwinds in reverse on
 * `revert`/`tryRevert`.
 *
 * @example
 * ```typescript
 * const converter = new CloudEventConverter();
 * const cloudEvent = await converter.convert(arvoEvent);
 * const roundTripped = await converter.revert(cloudEvent);
 * ```
 */
export class CloudEventConverter {
  private readonly transformer: IArvoEventTransformer;
  private readonly converters: readonly ICloudEventConverter[];

  /**
   * @param transformer - The ArvoEvent↔CloudEvent mapping. Defaults to the
   * standard mapping; supply your own only if you need to replace it
   * entirely, not merely extend it — see `converters` for that.
   * @param converters - Additional CloudEvent-to-CloudEvent stages, applied
   * in order after `transformer` on `convert`, and unwound in reverse
   * before it on `revert`.
   */
  constructor(
    transformer?: IArvoEventTransformer,
    converters?: ICloudEventConverter[],
  ) {
    this.transformer = transformer ?? new ArvoToCloudEventConverter();
    this.converters = converters ?? [];
  }

  /**
   * Converts an ArvoEvent to a CloudEvent, reporting the outcome as a value
   * rather than throwing.
   *
   * The standard mapping itself cannot fail. If you supplied your own
   * `converters` and one of them throws, that failure is reported as
   * `result.error.detail.kind === 'stage'`, naming which stage
   * (`stageIndex`, counting `transformer` as `0` and each `converters`
   * entry from `1`) and carrying whatever it threw as `cause`.
   */
  async tryConvert(
    data: ArvoEvent,
  ): AsyncResult<CloudEvent, CloudEventTransformationError> {
    const stages: readonly AnyStage[] = [this.transformer, ...this.converters];
    const chain = stages.reduce<
      ResultAsync<unknown, CloudEventTransformationError>
    >(
      (acc, stage, stageIndex) =>
        acc.andThen((value) =>
          ResultAsync.fromPromise(stage.convert(value), (cause) =>
            toStageError(cause, 'convert', stageIndex),
          ),
        ),
      okAsync<unknown, CloudEventTransformationError>(data),
    );
    return fromNeverthrowAsync(
      chain as ResultAsync<CloudEvent, CloudEventTransformationError>,
    );
  }

  /**
   * Converts an ArvoEvent to a CloudEvent, throwing on failure.
   *
   * @throws {CloudEventTransformationError} If a `converters` stage you
   * supplied fails. The standard mapping itself never fails.
   */
  async convert(data: ArvoEvent): Promise<CloudEvent> {
    const result = await this.tryConvert(data);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * Reverts a CloudEvent to an ArvoEvent, reporting the outcome as a value
   * rather than throwing.
   *
   * A CloudEvent produced by this converter (or claiming to be one) is
   * reversed strictly: every field must decode correctly, or the whole
   * CloudEvent is rejected as `result.error.detail.kind === 'strict'`. A
   * CloudEvent claiming no ArvoEvent shape at all is instead adapted as a
   * foreign event (`result.error.detail.kind === 'foreign'` on failure),
   * using `foreignFallback` to supply whatever it can't recover from the
   * CloudEvent itself. If you supplied your own `converters` and one of
   * them throws while unwinding, that failure is reported as
   * `result.error.detail.kind === 'stage'`.
   *
   * @param foreignFallback - Values to use for a foreign CloudEvent's
   * missing fields — `dataschema` is always required, since it can never be
   * recovered from the foreign CloudEvent itself. Ignored when reverting a
   * CloudEvent that already carries ArvoEvent shape, whose own fields are
   * always authoritative.
   */
  async tryRevert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<ArvoEvent, CloudEventTransformationError> {
    const stages: readonly AnyStage[] = [this.transformer, ...this.converters];
    const chain = stages.reduceRight<
      ResultAsync<unknown, CloudEventTransformationError>
    >(
      (acc, stage, stageIndex) =>
        acc.andThen((value) =>
          ResultAsync.fromPromise(
            stageIndex === 0
              ? (stage.revert as TransformerRevert)(value, foreignFallback)
              : stage.revert(value),
            (cause) => toStageError(cause, 'revert', stageIndex),
          ),
        ),
      okAsync<unknown, CloudEventTransformationError>(data),
    );
    return fromNeverthrowAsync(
      chain as ResultAsync<ArvoEvent, CloudEventTransformationError>,
    );
  }

  /**
   * Reverts a CloudEvent to an ArvoEvent, throwing on failure.
   *
   * @param foreignFallback - See {@link tryRevert}.
   * @throws {CloudEventTransformationError} If the CloudEvent cannot be
   * reverted — see {@link tryRevert} for the distinct failure cases.
   */
  async revert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent> {
    const result = await this.tryRevert(data, foreignFallback);
    if (result.ok) return result.value;
    throw result.error;
  }
}
