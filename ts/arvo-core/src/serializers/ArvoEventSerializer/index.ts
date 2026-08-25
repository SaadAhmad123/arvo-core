import { err, ok } from 'neverthrow';
import { ArvoEvent } from '../../ArvoEvent/index.js';
import { CloudEventTransformationError } from '../../cloudevent/errors.js';
import { CloudEventConverter } from '../../cloudevent/index.js';
import type { ForeignCloudEventFallback } from '../../cloudevent/types.js';
import { CloudEvent } from '../../cloudevent/types.js';
import { fromNeverthrow } from '../../result.js';
import type { AsyncResult } from '../../types.js';
import { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoEventSerializerError } from './errors.js';

/**
 * Which wire format an {@link ArvoEventSerializer} reads and writes, fixed
 * for the instance's lifetime — there is no per-call format switch or
 * auto-detection between the two.
 */
export type ArvoEventSerializerMode =
  | { type: 'arvoevent' }
  | { type: 'cloudevent'; converter?: CloudEventConverter };

/**
 * {@link ArvoEventSerializerMode} as the constructor actually stores it:
 * `converter` is optional on the public type because a caller need not
 * supply one, but every stored `cloudevent`-mode instance always has one —
 * the constructor's own default fills the gap. Typing `this.mode` as this
 * narrower shape lets that invariant be enforced by the compiler at every
 * use site, instead of by an `as CloudEventConverter` cast repeated at each
 * one.
 */
type NormalizedMode =
  | { type: 'arvoevent' }
  | { type: 'cloudevent'; converter: CloudEventConverter };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Converts an {@link ArvoEvent} to and from a wire string, in either of two
 * selectable formats: the event's own default JSON shape (`arvoevent`), or
 * the CloudEvent-shaped JSON `CloudEventConverter` produces (`cloudevent`,
 * the default). Owns the format-specific boundary work — `JSON.stringify`/
 * `JSON.parse`, and, in `cloudevent` mode, wrapping a plain parsed object as
 * a `CloudEvent` before reverting it — so a consumer never has to discover
 * either mechanism's own boundary requirements themselves.
 *
 * @example
 * ```typescript
 * const serializer = new ArvoEventSerializer();
 * const wire = await serializer.serialize(arvoEvent);
 * const roundTripped = await serializer.deserialize(wire);
 * ```
 *
 * @example
 * Distinguishing this class's own boundary failures from the underlying
 * transformation's:
 * ```typescript
 * try {
 *   await serializer.deserialize(wire);
 * } catch (error) {
 *   if (error instanceof ArvoEventSerializerError) {
 *     log('malformed input', error.cause);
 *   } else if (error instanceof CloudEventTransformationError) {
 *     log('transformation failed', error.detail);
 *   }
 * }
 * ```
 */
export class ArvoEventSerializer {
  private readonly mode: NormalizedMode;

  constructor(mode?: ArvoEventSerializerMode) {
    this.mode = {
      type: 'cloudevent',
      converter: new CloudEventConverter(),
    };

    if (mode?.type === 'cloudevent') {
      this.mode = {
        type: 'cloudevent',
        converter: mode.converter ?? new CloudEventConverter(),
      };
    }

    if (mode?.type === 'arvoevent') {
      this.mode = mode;
    }
  }

  /**
   * Serializes an `ArvoEvent` to a wire string, reporting the outcome as a
   * value rather than throwing.
   *
   * A `converters` stage on a caller-supplied `CloudEventConverter` failing
   * during `convert` reports as `CloudEventTransformationError`, unwrapped.
   * A stage that succeeds but hands back a value `JSON.stringify` itself
   * rejects (a circular reference, a `BigInt`) reports as
   * `ArvoEventSerializerError` instead — the default configuration in
   * either mode cannot fail at all.
   */
  async trySerialize(
    event: ArvoEvent,
  ): AsyncResult<
    string,
    CloudEventTransformationError | ArvoEventSerializerError
  > {
    if (this.mode.type === 'arvoevent') {
      return fromNeverthrow(ok(JSON.stringify(event)));
    }
    const converter = this.mode.converter;
    const result = await converter.tryConvert(event);
    if (!result.ok) return result;
    try {
      return fromNeverthrow(ok(JSON.stringify(result.value)));
    } catch (cause) {
      return fromNeverthrow(err(new ArvoEventSerializerError(cause as Error)));
    }
  }

  /**
   * Serializes an `ArvoEvent` to a wire string, throwing on failure.
   *
   * @throws {CloudEventTransformationError | ArvoEventSerializerError} See
   * {@link trySerialize} for the distinct failure cases.
   */
  async serialize(event: ArvoEvent): Promise<string> {
    const result = await this.trySerialize(event);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * Deserializes a wire string back to an `ArvoEvent`, reporting the
   * outcome as a value rather than throwing.
   *
   * `data` that isn't valid JSON, and (in `arvoevent` mode) a parsed value
   * that isn't a structurally valid `ArvoEvent`, both report as
   * `ArvoEventSerializerError` with the original error available via
   * `.cause`. In `cloudevent` mode, a parsed value is wrapped as a
   * `CloudEvent` (bypassing its own construction-time conformance check —
   * `tryRevert`'s own discriminator is more informative) and reverted
   * directly; a value with no `specversion` field is rejected before that,
   * as `CloudEventTransformationError`, since it cannot be a CloudEvent of
   * any kind — otherwise `arvoevent`-mode wire JSON handed to a
   * `cloudevent`-mode `deserialize` could be silently misadapted rather
   * than cleanly rejected.
   *
   * @param foreignFallback - Consulted only in `cloudevent` mode, for a
   * CloudEvent that claims no ArvoEvent shape. Ignored in `arvoevent` mode.
   */
  async tryDeserialize<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    data: string,
    foreignFallback?: ForeignCloudEventFallback,
  ): AsyncResult<
    ArvoEvent<T, D>,
    CloudEventTransformationError | ArvoEventSerializerError
  > {
    let parsed: unknown;
    try {
      parsed = JSON.parse(data);
    } catch (cause) {
      return fromNeverthrow(err(new ArvoEventSerializerError(cause as Error)));
    }

    if (this.mode.type === 'arvoevent') {
      const result = ArvoEvent.tryParse<T, D>(parsed);
      if (result.ok) return result;
      return fromNeverthrow(err(new ArvoEventSerializerError(result.error)));
    }

    if (!isRecord(parsed) || typeof parsed.specversion !== 'string') {
      return fromNeverthrow(
        err(
          new CloudEventTransformationError({
            kind: 'foreign',
            issues: [
              new ErrorIssue({
                path: 'specversion',
                message: 'is required',
                received: parsed,
              }),
            ],
          }),
        ),
      );
    }

    const converter = this.mode.converter;
    const cloudEvent = new CloudEvent<Record<string, unknown>>(
      parsed as never,
      false,
    );
    return converter.tryRevert<T, D>(cloudEvent, foreignFallback);
  }

  /**
   * Deserializes a wire string back to an `ArvoEvent`, throwing on failure.
   *
   * @param foreignFallback - See {@link tryDeserialize}.
   * @throws {CloudEventTransformationError | ArvoEventSerializerError} See
   * {@link tryDeserialize} for the distinct failure cases.
   */
  async deserialize<
    T extends string = string,
    D extends Record<string, any> = Record<string, any>,
  >(
    data: string,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent<T, D>> {
    const result = await this.tryDeserialize<T, D>(data, foreignFallback);
    if (result.ok) return result.value;
    throw result.error;
  }
}
