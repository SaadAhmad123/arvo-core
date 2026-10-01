import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import type { ArvoContract } from '../../../ArvoContract/index.js';
import type { VersionedArvoContract } from '../../../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../../../ArvoEvent/index.js';
import { fromNeverthrow } from '../../../result.js';
import type { ArvoSemanticVersion } from '../../../semver/index.js';
import type { Result } from '../../../types.js';
import { ErrorIssue } from '../../../utils/error-issue.js';
import type { ArvoFaultKind } from '../../fault/types.js';
import type { ArvoServiceMap } from '../../types/services.js';
import { ArvoEventValidatorError } from './errors.js';
import type { ArvoEventOrigin, ArvoEventValidatorParam } from './types.js';

/**
 * Judges whether an event belongs to the contracts a handler declared, and
 * whether its payload satisfies the schema they select for it.
 *
 * Built once from the declaration and reused for every delivery, so it
 * reports rather than raising a fault. The version comes from the event's
 * own `dataschema`, never supplied, so this runs before one is known.
 *
 * @example
 * ```typescript
 * const validator = new ArvoEventValidator({
 *   contracts: { self: orderContract, services: { payments } },
 * });
 *
 * const arriving = validator.validateInput(delivered);
 * if (arriving.ok) arriving.value; // { source: 'self', version: '1.0.0' }
 * ```
 */
export class ArvoEventValidator<
  TSelf extends ArvoContract = ArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
> {
  /** The contract implemented, and every contract it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };

  /** @param param - The contracts to judge against. */
  constructor(param: ArvoEventValidatorParam<TSelf, TServices>) {
    this.contracts = Object.freeze({
      self: param.contracts.self,
      services: Object.freeze({ ...param.contracts.services }),
    });
  }

  /**
   * Where an event arriving came from, or why it could not have arrived.
   *
   * Two shapes are admissible: the implemented contract's own input type at
   * one of its versions, or anything a declared service answers with.
   *
   * @param event - The event that arrived.
   * @returns Which contract it belongs to and at which version, or every
   * rule it broke.
   */
  validateInput(
    event: ArvoEvent,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    const ownVersion = this.#selfVersionOf(event);
    if (ownVersion !== null) {
      if (event.type !== this.contracts.self.type) {
        return this.#refuse(
          'type_not_receivable',
          `${event.type} is not what this contract takes in`,
          [
            new ErrorIssue({
              path: 'type',
              message: `must be ${this.contracts.self.type} for an event opening an execution of ${this.contracts.self.uri}`,
              received: event.type,
            }),
          ],
        );
      }
      return this.#checked(
        event,
        this.contracts.self.versions[ownVersion].input,
        { source: 'self', version: ownVersion },
      );
    }

    const service = this.#serviceOf(event);
    if (service === null) return this.#unclaimed(event);

    const schema =
      event.type === service.error.type
        ? service.error.schema
        : service.outputs[event.type];
    if (schema === undefined) {
      return this.#refuse(
        'type_not_receivable',
        `${service.uri} never answers with ${event.type}`,
        [
          new ErrorIssue({
            path: 'type',
            message: `must be one of ${[...Object.keys(service.outputs), service.error.type].join(', ')}`,
            received: event.type,
          }),
        ],
      );
    }

    return this.#checked(event, schema, {
      source: 'service',
      version: service.version,
    });
  }

  /**
   * Where an event being emitted is going, or why it may not be.
   *
   * Two shapes are admissible: a declared service's input type, or one of
   * the implemented contract's own outputs. The handler error type is
   * refused, producing one being the handler's and never an executor's.
   *
   * @param event - The event to be emitted.
   * @returns Which contract it belongs to and at which version, or every
   * rule it broke.
   */
  validateOutput(
    event: ArvoEvent,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    const service = this.#serviceOf(event);
    if (service !== null) {
      if (event.type !== service.type) {
        return this.#refuse(
          'emission_not_permitted',
          `${event.type} is what ${service.uri} answers with, not what it takes in`,
          [
            new ErrorIssue({
              path: 'type',
              message: `must be ${service.type} for an event addressed to ${service.uri}`,
              received: event.type,
            }),
          ],
        );
      }
      return this.#checked(event, service.input, {
        source: 'service',
        version: service.version,
      });
    }

    const ownVersion = this.#selfVersionOf(event);
    if (ownVersion === null) return this.#unclaimed(event);

    const version = this.contracts.self.versions[ownVersion];
    if (event.type === version.error.type) {
      return this.#refuse(
        'emission_not_permitted',
        `${event.type} is this contract's handler error event, which is not an executor's to emit`,
        [
          new ErrorIssue({
            path: 'type',
            message: 'must be one of this version’s declared outputs',
            received: event.type,
          }),
        ],
      );
    }

    const schema = version.outputs[event.type];
    if (schema === undefined) {
      return this.#refuse(
        'emission_not_permitted',
        `${event.type} is not something ${this.contracts.self.uri} declares at ${ownVersion}`,
        [
          new ErrorIssue({
            path: 'type',
            message: `must be one of ${Object.keys(version.outputs).join(', ') || 'nothing, this version declaring no outputs'}`,
            received: event.type,
          }),
        ],
      );
    }

    return this.#checked(event, schema, {
      source: 'self',
      version: ownVersion,
    });
  }

  /** The version of the implemented contract an event names, if any. */
  #selfVersionOf(event: ArvoEvent): ArvoSemanticVersion | null {
    const found = Object.keys(this.contracts.self.versions).find(
      (version) =>
        this.contracts.self.versions[version as ArvoSemanticVersion]
          .dataschema === event.dataschema,
    );
    return (found as ArvoSemanticVersion | undefined) ?? null;
  }

  /** The declared service an event names, if any. */
  #serviceOf(event: ArvoEvent): VersionedArvoContract | null {
    return (
      Object.values(this.contracts.services).find(
        (service) => service.dataschema === event.dataschema,
      ) ?? null
    );
  }

  /** An event whose `dataschema` names nothing this handler declared. */
  #unclaimed(
    event: ArvoEvent,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    return this.#refuse(
      'event_unclassifiable',
      `${event.dataschema} names no contract this handler declared`,
      [
        new ErrorIssue({
          path: 'dataschema',
          message: `must name ${this.contracts.self.uri} or one of ${Object.values(
            this.contracts.services,
          )
            .map((service) => service.uri)
            .join(', ')}`,
          received: event.dataschema,
        }),
      ],
    );
  }

  /** An event's payload judged against the schema its type selects. */
  #checked(
    event: ArvoEvent,
    schema: unknown,
    origin: ArvoEventOrigin,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    const result = z.safeParse(schema as z.$ZodType, event.data);
    if (result.success) return fromNeverthrow(ok(origin));

    const at = (issue: { path: PropertyKey[] }) =>
      issue.path.join('.') || '(root)';
    return this.#refuse(
      origin.source === 'self' && event.type === this.contracts.self.type
        ? 'event_schema_rejected'
        : 'emission_schema_rejected',
      `the payload of ${event.type} does not satisfy ${event.dataschema}.`,
      result.error.issues.map(
        (issue) =>
          new ErrorIssue({ path: `data.${at(issue)}`, message: issue.message }),
      ),
    );
  }

  /** One refusal, as the error a caller reads. */
  #refuse(
    faultKind: ArvoFaultKind,
    heading: string,
    issues: ErrorIssue[],
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    return fromNeverthrow(
      err(new ArvoEventValidatorError(faultKind, heading, issues)),
    );
  }
}
