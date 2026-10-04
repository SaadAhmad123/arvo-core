import { err, ok } from 'neverthrow';
import * as z from 'zod/v4/core';
import { readDataschema } from '../../../ArvoContract/assert.js';
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
 * Built once from the declaration and reused for every execution, so it
 * reports rather than raising a fault. The version comes from the event's
 * own `dataschema`, never supplied, so this runs before one is known.
 *
 * @example
 * ```typescript
 * const validator = new ArvoEventValidator({
 *   contracts: { self: orderContract, services: { payments } },
 * });
 *
 * const arriving = validator.validateInput(triggeringEvent);
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
    const resolved = this.resolveInput(event);
    if (!resolved.ok) return resolved;
    const checked = this.checkInput(event, resolved.value);
    return checked === null ? resolved : fromNeverthrow(err(checked));
  }

  /**
   * Which contract an arriving event belongs to, and at which version.
   *
   * Resolution alone: it says where the event came from and says nothing
   * about whether its type or its payload are ones that contract can
   * send. A caller that wants both at once uses {@link validateInput}; a
   * caller sequencing them itself checks with {@link checkInput}.
   *
   * @param event - The event that arrived.
   * @returns Which contract it belongs to and at which version, or why
   * it belongs to none of them.
   */
  resolveInput(
    event: ArvoEvent,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    const named = readDataschema(event.dataschema);
    if (!named.ok) return this.#unclaimed(event);

    const { uri, version } = named.value;
    if (uri !== this.contracts.self.uri) {
      return this.#answering(event, this.#serviceAt(uri), version);
    }

    // The one overlap: this contract is both what the handler implements
    // and something it may send to, so the uri names two roles and only
    // the type says which. Legitimate because a contract's input type
    // matches neither its outputs nor its handler error type.
    const selfAsService = this.#serviceAt(uri);
    if (selfAsService !== null && event.type !== this.contracts.self.type) {
      return this.#answers(selfAsService, event.type)
        ? this.#answering(event, selfAsService, version)
        : this.#refuse(
            'event_unclassifiable',
            `${event.type} is neither what ${uri} takes in nor anything it answers with, so nothing says whether this opens an execution or answers one`,
            [
              new ErrorIssue({
                path: 'type',
                message: `must be ${this.contracts.self.type} to open an execution, or one of ${[...Object.keys(selfAsService.outputs), selfAsService.error.type].join(', ')} to answer one`,
                received: event.type,
              }),
            ],
          );
    }

    return this.#opening(event, version);
  }

  /** An event read as one opening an execution of the contract. */
  #opening(
    event: ArvoEvent,
    version: string,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    const declared =
      this.contracts.self.versions[version as ArvoSemanticVersion];
    if (declared === undefined) {
      return this.#refuse(
        'event_unclassifiable',
        `${this.contracts.self.uri} declares no version ${version}, so nothing would run this`,
        [
          new ErrorIssue({
            path: 'dataschema',
            message: `must name one of ${Object.keys(this.contracts.self.versions).join(', ')}`,
            received: event.dataschema,
          }),
        ],
      );
    }

    return fromNeverthrow(
      ok({ source: 'self', version: declared.version, contract: declared }),
    );
  }

  /** An event read as one a declared service answered with. */
  #answering(
    event: ArvoEvent,
    service: VersionedArvoContract | null,
    version: string,
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    if (service === null) return this.#unclaimed(event);

    // A response names its own service's version, and this handler
    // declared exactly one. Any other is two deployments that have drifted
    // apart, which would otherwise be judged against the wrong schema.
    if (service.version !== version) {
      return this.#refuse(
        'event_unclassifiable',
        `${service.uri} was declared at ${service.version}, and this answers at ${version}`,
        [
          new ErrorIssue({
            path: 'dataschema',
            message: `must name ${service.uri} at ${service.version}, the version this handler declared`,
            received: event.dataschema,
          }),
        ],
      );
    }

    return fromNeverthrow(
      ok({ source: 'service', version: service.version, contract: service }),
    );
  }

  /**
   * Whether a resolved event is one its contract can send here, and
   * whether its payload is what that contract says it is.
   *
   * Separate from resolution so a caller enforcing the protocol's own
   * order can run it where that order puts it, rather than where it
   * happens to be convenient.
   *
   * @param event - The event that arrived.
   * @param origin - What {@link resolveInput} resolved it to.
   * @returns Why it is refused, or `null` where it is not.
   */
  checkInput(
    event: ArvoEvent,
    origin: ArvoEventOrigin,
  ): ArvoEventValidatorError | null {
    const receivable =
      origin.source === 'self'
        ? this.#takenIn(origin.contract, event.type)
        : this.#answeredWith(origin.contract, event.type);

    if (receivable === null) {
      return this.#refusal(
        'type_not_receivable',
        origin.source === 'self'
          ? `${event.type} is not what ${origin.contract.uri} takes in`
          : `${origin.contract.uri} never answers with ${event.type}`,
        [
          new ErrorIssue({
            path: 'type',
            message:
              origin.source === 'self'
                ? `must be ${origin.contract.type} for an event opening an execution of ${origin.contract.uri}`
                : `must be one of ${[...Object.keys(origin.contract.outputs), origin.contract.error.type].join(', ')}`,
            received: event.type,
          }),
        ],
      );
    }

    const judged = z.safeParse(receivable as z.$ZodType, event.data);
    if (judged.success) return null;

    const fieldOf = (issue: { path: PropertyKey[] }) =>
      issue.path.join('.') || '(root)';
    return this.#refusal(
      'event_schema_rejected',
      `the payload of ${event.type} does not satisfy ${event.dataschema}.`,
      judged.error.issues.map(
        (issue) =>
          new ErrorIssue({
            path: `data.${fieldOf(issue)}`,
            message: issue.message,
          }),
      ),
    );
  }

  /** The schema for what a contract takes in, where this type is it. */
  #takenIn(contract: VersionedArvoContract, type: string): unknown {
    return type === contract.type ? contract.input : null;
  }

  /** The schema for what a contract answers with, where this type is one. */
  #answeredWith(contract: VersionedArvoContract, type: string): unknown {
    if (type === contract.error.type) return contract.error.schema;
    return contract.outputs[type] ?? null;
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
        contract: service,
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
      contract: version,
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

  /** Whether a type is one this service answers with. */
  #answers(service: VersionedArvoContract, type: string): boolean {
    return type === service.error.type || type in service.outputs;
  }

  /** The service declared for a contract, whichever version it was declared at. */
  #serviceAt(uri: string): VersionedArvoContract | null {
    return (
      Object.values(this.contracts.services).find(
        (service) => service.uri === uri,
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

    const fieldOf = (issue: { path: PropertyKey[] }) =>
      issue.path.join('.') || '(root)';
    return this.#refuse(
      origin.source === 'self' && event.type === this.contracts.self.type
        ? 'event_schema_rejected'
        : 'emission_schema_rejected',
      `the payload of ${event.type} does not satisfy ${event.dataschema}.`,
      result.error.issues.map(
        (issue) =>
          new ErrorIssue({
            path: `data.${fieldOf(issue)}`,
            message: issue.message,
          }),
      ),
    );
  }

  /** One refusal, as the error a caller reads. */
  #refusal(
    faultKind: ArvoFaultKind,
    heading: string,
    issues: ErrorIssue[],
  ): ArvoEventValidatorError {
    return new ArvoEventValidatorError(faultKind, heading, issues);
  }

  /** One refusal, reported rather than returned. */
  #refuse(
    faultKind: ArvoFaultKind,
    heading: string,
    issues: ErrorIssue[],
  ): Result<ArvoEventOrigin, ArvoEventValidatorError> {
    return fromNeverthrow(err(this.#refusal(faultKind, heading, issues)));
  }
}
