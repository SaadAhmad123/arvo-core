import { okAsync, ResultAsync } from 'neverthrow';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { fromNeverthrowAsync } from '../result.js';
import type { AsyncResult } from '../types.js';
import { defaultConverter } from './default/index.js';
import { CloudEventTransformationError } from './errors.js';
import type { IConverter } from './interface.js';
import type { CloudEvent, ForeignCloudEventFallback } from './types.js';

type Stages = [
  IConverter<ArvoEvent, CloudEvent>,
  ...IConverter<CloudEvent, CloudEvent>[],
];

/**
 * Every stage's `convert`/`revert`, viewed uniformly as `unknown -> unknown`.
 * A pipeline's stages are genuinely heterogeneous — stage 0 is
 * `ArvoEvent <-> CloudEvent`, every stage after it is `CloudEvent <->
 * CloudEvent` — and TypeScript has no way to track that chain of types
 * through a dynamic-length array at compile time. This module's own public
 * methods stay precisely typed; only this internal loop drops to `unknown`,
 * the same trade-off any pipeline runner over a heterogeneous stage list
 * makes.
 */
type AnyConverter = {
  convert(data: unknown): Promise<unknown>;
  revert(data: unknown): Promise<unknown>;
};

/** The base stage's own `revert`, extended with the `foreignFallback` no other stage in the pipeline understands or needs. */
type BaseRevert = (
  data: unknown,
  foreignFallback?: ForeignCloudEventFallback,
) => Promise<unknown>;

/**
 * A stage's own thrown value is preserved verbatim as `cause` — unless it
 * is already a {@link CloudEventTransformationError}, in which case it is
 * passed through unchanged rather than double-wrapped. The base stage's own
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
 * The public entry point: an ordered list of paired, reversible stages,
 * with the base field-placement mapping wired in as stage 0 by default.
 * Both directions run every stage in sequence and stop at the first one
 * that throws — a stage's input depends on the one before it, so there is
 * at most one failure per call, never a batch to aggregate.
 */
export class CloudEventConverter {
  private readonly stages: Stages;

  constructor(converters?: Stages) {
    this.stages = converters ?? [defaultConverter];
  }

  /**
   * Runs every stage forward, starting with the base mapping's own
   * `convert`. Never throws — the primitive; {@link convert} is the
   * throwing convenience built on top of it.
   */
  async tryConvert(
    data: ArvoEvent,
  ): AsyncResult<CloudEvent, CloudEventTransformationError> {
    const stages = this.stages as unknown as readonly AnyConverter[];
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

  /** A throwing convenience with no logic of its own beyond unwrapping {@link tryConvert}. */
  async convert(data: ArvoEvent): Promise<CloudEvent> {
    const result = await this.tryConvert(data);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * Unwinds any consumer-appended stages in reverse order, then runs the
   * base mapping's own `revert`, which alone receives `foreignFallback`.
   * Never throws — the primitive; {@link revert} is the throwing
   * convenience built on top of it.
   */
  async tryRevert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<ArvoEvent, CloudEventTransformationError> {
    const stages = this.stages as unknown as readonly AnyConverter[];
    const chain = stages.reduceRight<
      ResultAsync<unknown, CloudEventTransformationError>
    >(
      (acc, stage, stageIndex) =>
        acc.andThen((value) =>
          ResultAsync.fromPromise(
            stageIndex === 0
              ? (stage.revert as BaseRevert)(value, foreignFallback)
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

  /** A throwing convenience with no logic of its own beyond unwrapping {@link tryRevert}. */
  async revert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent> {
    const result = await this.tryRevert(data, foreignFallback);
    if (result.ok) return result.value;
    throw result.error;
  }
}
