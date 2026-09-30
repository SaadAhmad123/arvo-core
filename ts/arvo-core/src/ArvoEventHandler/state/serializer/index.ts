import { err, ok } from 'neverthrow';
import type * as z from 'zod/v4/core';
import type { ArvoEvent } from '../../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../../result.js';
import { ArvoEventSerializer } from '../../../serializers/ArvoEventSerializer/index.js';
import type { AsyncResult } from '../../../types.js';
import { ErrorIssue } from '../../../utils/error-issue.js';
import { ArvoExecutionStateValidationError } from '../errors.js';
import { ArvoExecutionState } from '../index.js';
import { isPlainObject } from '../validator.js';
import { ArvoExecutionStateSerializerError } from './errors.js';

/** Everything that can go wrong turning a record into a string, or back. */
type ArvoExecutionStateSerializerFailure =
  | ArvoExecutionStateSerializerError
  | ArvoExecutionStateValidationError;

/**
 * Turns what an execution remembers into a string, and a string back into
 * what an execution remembers.
 *
 * Bound at construction to one version's data schema, a record carrying
 * none, so it reads back records of that version only. Writing never
 * consults it, so one built without a schema writes but cannot read.
 *
 * The events inside are written in the event's own format. Fixed, not a
 * choice: a stored record is read by whatever reads it next.
 *
 * @example
 * ```typescript
 * const serializer = new ArvoExecutionStateSerializer(orderData);
 * const wire = await serializer.serialize(state);
 * const restored = await serializer.deserialize(wire);
 * ```
 */
export class ArvoExecutionStateSerializer<
  TDataSchema extends z.$ZodObject = z.$ZodObject,
> {
  /** Owns the format the events inside a record are written in. */
  readonly #events = new ArvoEventSerializer({ type: 'arvoevent' });

  /**
   * @param dataschema - The schema governing the data of the version whose
   * records this reads back. Omit it to write only.
   */
  constructor(private readonly dataschema?: TDataSchema) {}

  /**
   * A record written out as a string, reporting the outcome rather than
   * throwing.
   *
   * Fails only where something the record holds cannot be turned into JSON
   * at all, which for a record built through the normal route means its
   * data.
   */
  async trySerialize(
    state: ArvoExecutionState<TDataSchema>,
  ): AsyncResult<string, ArvoExecutionStateSerializerError> {
    const initEvent = await this.#tryWriteEvent(state.initEvent);
    if (!initEvent.ok) return initEvent;
    const triggeringEvent = await this.#tryWriteEvent(state.triggeringEvent);
    if (!triggeringEvent.ok) return triggeringEvent;

    const inFlight: [string, unknown][] = [];
    for (const [id, answer] of state.inFlightEventMap) {
      if (answer === null) {
        inFlight.push([id, null]);
        continue;
      }
      const written = await this.#tryWriteEvent(answer);
      if (!written.ok) return written;
      inFlight.push([id, written.value]);
    }

    try {
      return fromNeverthrow(
        ok(
          JSON.stringify({
            ...state.toJSON(),
            initEvent: initEvent.value,
            triggeringEvent: triggeringEvent.value,
            inFlightEventMap: inFlight,
          }),
        ),
      );
    } catch (cause) {
      return fromNeverthrow(
        err(new ArvoExecutionStateSerializerError(cause as Error)),
      );
    }
  }

  /**
   * A record written out as a string.
   *
   * @throws {ArvoExecutionStateSerializerError} If something the record
   * holds cannot be turned into JSON.
   */
  async serialize(state: ArvoExecutionState<TDataSchema>): Promise<string> {
    const result = await this.trySerialize(state);
    if (result.ok) return result.value;
    throw result.error;
  }

  /**
   * A record restored from a string, reporting the outcome rather than
   * throwing.
   *
   * Every event comes back as an event. Data is checked against the schema
   * but never rewritten by it, so what comes back is what was stored.
   *
   * A string that is not JSON is a serializer failure; a record that reads
   * but is wrong is a validation failure naming every field at fault.
   * Nothing half restored is given back.
   *
   * Reports a serializer failure where this was built without a schema,
   * there being nothing to check the data against.
   */
  async tryDeserialize(
    wire: string,
  ): AsyncResult<
    ArvoExecutionState<TDataSchema>,
    ArvoExecutionStateSerializerFailure
  > {
    if (this.dataschema === undefined) {
      return fromNeverthrow(
        err(
          new ArvoExecutionStateSerializerError(
            new TypeError(
              'this serializer was built without a schema, so it writes records but cannot read one back',
            ),
          ),
        ),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(wire);
    } catch (cause) {
      return fromNeverthrow(
        err(new ArvoExecutionStateSerializerError(cause as Error)),
      );
    }

    if (!isPlainObject(parsed)) {
      return fromNeverthrow(
        err(
          new ArvoExecutionStateSerializerError(
            new TypeError('a stored record must be a JSON object'),
          ),
        ),
      );
    }

    const issues: ErrorIssue[] = [];
    const restored: Record<string, unknown> = { ...parsed };

    for (const field of ['initEvent', 'triggeringEvent'] as const) {
      const event = await this.#tryReadEvent(parsed[field]);
      if (event.ok) restored[field] = event.value;
      else issues.push(this.#issueFor(field, parsed[field], event.error));
    }

    if (Array.isArray(parsed.inFlightEventMap)) {
      const awaited = new Map<string, ArvoEvent | null>();
      for (const entry of parsed.inFlightEventMap) {
        const [id, answer] = Array.isArray(entry) ? entry : [undefined, null];
        const path = `inFlightEventMap[${String(id)}]`;
        if (answer === null || answer === undefined) {
          awaited.set(id as string, null);
          continue;
        }
        const event = await this.#tryReadEvent(answer);
        if (event.ok) awaited.set(id as string, event.value);
        else issues.push(this.#issueFor(path, answer, event.error));
      }
      restored.inFlightEventMap = awaited;
    }

    if (issues.length > 0) {
      return fromNeverthrow(err(new ArvoExecutionStateValidationError(issues)));
    }
    return ArvoExecutionState.tryBuild(restored, this.dataschema);
  }

  /**
   * A record restored from a string.
   *
   * @throws {ArvoExecutionStateSerializerError} If the string is not a
   * stored record at all.
   * @throws {ArvoExecutionStateValidationError} If it is readable but
   * wrong, naming every field at fault.
   */
  async deserialize(wire: string): Promise<ArvoExecutionState<TDataSchema>> {
    const result = await this.tryDeserialize(wire);
    if (result.ok) return result.value;
    throw result.error;
  }

  /** One event as the plain object a record embeds. */
  async #tryWriteEvent(
    event: ArvoEvent,
  ): AsyncResult<unknown, ArvoExecutionStateSerializerError> {
    const written = await this.#events.trySerialize(event);
    if (!written.ok) {
      return fromNeverthrow(
        err(new ArvoExecutionStateSerializerError(written.error)),
      );
    }
    return fromNeverthrow(ok(JSON.parse(written.value)));
  }

  /** One embedded object back as an event. */
  async #tryReadEvent(value: unknown): AsyncResult<ArvoEvent, Error> {
    const read = await this.#events.tryDeserialize(JSON.stringify(value));
    return read.ok ? read : fromNeverthrow(err(read.error));
  }

  /** An event that would not restore, named where it sits in the record. */
  #issueFor(path: string, received: unknown, cause: Error): ErrorIssue {
    return new ErrorIssue({
      path,
      message: `is not a stored ArvoEvent: ${cause.message}`,
      received,
    });
  }
}
