import { okAsync, ResultAsync } from 'neverthrow';
import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { fromNeverthrowAsync } from '../../result.js';
import type { AsyncResult } from '../../types.js';
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
 *
 * // what actually crosses a network — CloudEvent's own toJSON() runs here
 * const wireBody = JSON.stringify(cloudEvent);
 * const received = new CloudEvent(JSON.parse(wireBody), false);
 * const roundTripped = await converter.revert(received);
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
   * The standard mapping can't fail; a `converters` stage throwing reports
   * as `result.error.detail.kind === 'stage'`, naming `stageIndex`
   * (`transformer` is `0`, `converters` entries from `1`) and `cause`.
   *
   * @example
   * ```typescript
   * const result = await converter.tryConvert(arvoEvent);
   * if (result.ok) {
   *   sendToBroker(result.value); // a CloudEvent
   * } else if (result.error.detail.kind === 'stage') {
   *   log(`stage ${result.error.detail.stageIndex} failed`, result.error.detail.cause);
   * }
   * ```
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
   *
   * @example
   * ```typescript
   * const cloudEvent = await converter.convert(arvoEvent);
   * sendToBroker(cloudEvent);
   * ```
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
   * An Arvo-shaped CloudEvent is reversed strictly (`'strict'` on failure);
   * one claiming no ArvoEvent shape is adapted as foreign instead, using
   * `foreignFallback` for whatever it can't recover (`'foreign'` on
   * failure). A `converters` stage throwing while unwinding reports as
   * `'stage'` — check `result.error.detail.kind`.
   *
   * @param foreignFallback - Values for a foreign CloudEvent's missing
   * fields; `dataschema` is always required, since it's never recoverable
   * from the CloudEvent itself. Ignored once a CloudEvent already carries
   * ArvoEvent shape. `source`/`dataschema` — from the CloudEvent or here —
   * must already be in `ArvoEvent`'s own exact RFC 3986 canonical form; a
   * valid but non-canonical URI (e.g. `https://example.com`, no trailing
   * path) is rejected, not normalized.
   *
   * @example
   * A plain object needs wrapping first — `new CloudEvent(data, false)`
   * skips conformance checking, which would otherwise reject the very
   * foreign shape this method is about to adapt:
   * ```typescript
   * const cloudEvent = new CloudEvent(plainObjectFromWire, false);
   * const result = await converter.tryRevert(cloudEvent, { dataschema: 'my-contract/1.0.0' });
   * if (result.ok) {
   *   handle(result.value); // an ArvoEvent
   * } else if (result.error.detail.kind === 'foreign') {
   *   log('could not adapt foreign event', result.error.detail.issues);
   * }
   * ```
   */
  async tryRevert<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<ArvoEvent<T, D>, CloudEventTransformationError> {
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
      chain as ResultAsync<ArvoEvent<T, D>, CloudEventTransformationError>,
    );
  }

  /**
   * Reverts a CloudEvent to an ArvoEvent, throwing on failure.
   *
   * @param foreignFallback - See {@link tryRevert}.
   * @throws {CloudEventTransformationError} See {@link tryRevert} for the
   * distinct failure cases.
   *
   * @example
   * A plain object needs wrapping first, as in {@link tryRevert}:
   * ```typescript
   * const cloudEvent = new CloudEvent(plainObjectFromWire, false);
   * const arvoEvent = await converter.revert(cloudEvent, { dataschema: 'my-contract/1.0.0' });
   * ```
   */
  async revert<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent<T, D>> {
    const result = await this.tryRevert<T, D>(data, foreignFallback);
    if (result.ok) return result.value;
    throw result.error;
  }
}
