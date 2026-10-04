import { type Meter, type Tracer, trace } from '@opentelemetry/api';
import { err, ok } from 'neverthrow';
import type { ArvoContract } from '../ArvoContract/index.js';
import type { VersionedArvoContract } from '../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import { continueTraceFromEvent } from '../ArvoEvent/opentelemetry.js';
import { fromNeverthrow } from '../result.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { AsyncResult, JSONObject } from '../types.js';
import type { ErrorIssue } from '../utils/error-issue.js';
import { pathSegmentForKey } from '../utils/issue-path.js';
import { ArvoExecutionContextTelemetry } from './context/telemetry/index.js';
import type { ArvoLogger } from './context/telemetry/types.js';
import { ArvoEventHandlerValidationError } from './errors.js';
import { createArvoHandlerFault } from './fault/factory.js';
import { ArvoHandlerFault } from './fault/index.js';
import {
  type ArvoResolvedEntry,
  refuseMiscategorised,
  refuseMismatchedPresence,
  refuseWithdrawnVersion,
} from './gate.js';
import { checkCollisions } from './helpers/check-collisions.js';
import { checkContract } from './helpers/check-contract.js';
import { checkOptions } from './helpers/check-options.js';
import { checkServices } from './helpers/check-services.js';
import { checkTimeouts } from './helpers/check-timeouts.js';
import { checkVersions } from './helpers/check-versions.js';
import {
  ARVO_ANY_STATE_SCHEMA,
  ARVO_DEFAULT_HANDLER_OPTIONS,
  ARVO_RECORD_FORMAT_VERSION,
} from './helpers/defaults.js';
import { deriveArvoExecutionId } from './helpers/execution-id.js';
import { resolveOptions } from './helpers/resolve-options.js';
import type { ArvoEventHandlerSetup } from './setup.js';
import { ArvoExecutionStateValidationError } from './state/errors.js';
import { createFollowupArvoExecutionState } from './state/factory.js';
import type { ArvoExecutionState } from './state/index.js';
import { describeEntry, markEntryStage } from './telemetry.js';
import type {
  ArvoEventHandlerExecuteParam,
  ArvoEventHandlerExecuteResponse,
} from './types/execute.js';
import type { ArvoEventHandlerOptions } from './types/options.js';
import type { ArvoServiceMap } from './types/services.js';
import type {
  ArvoDependencies,
  ArvoMechanismHooks,
  ArvoNone,
} from './types/supplied.js';
import type { ArvoVersionMap } from './types/version-map.js';
import { ArvoEventValidator } from './validators/event/index.js';
import type { ArvoEventOrigin } from './validators/event/types.js';
import { ArvoEventHandlerVersion } from './version/index.js';
import type { ArvoGateRefusal } from './version/types.js';

/**
 * A handler, declared and judged: one contract implemented, one executor
 * for each version it declares, and the contracts it may send to.
 *
 * Reached by declaring one through `setupArvoEventHandler` and finishing
 * with `build`. A handler that exists is one every declaration rule
 * accepted, so nothing downstream re-checks the declaration.
 *
 * `execute` is how an event reaches it: the handler places the event
 * against the contracts it declared, resolves the execution it concerns,
 * works through every check that must pass before business code runs,
 * and hands the execution to the version that owns it.
 *
 * It holds nothing between executions and reaches no store. Everything
 * it needs arrives with the event, and what it produces is handed back
 * to be committed and published by whatever runs it.
 *
 * @example
 * ```typescript
 * declare const handler: ArvoEventHandler<typeof orderContract>;
 *
 * // Reporting what could not be done.
 * const ran = await handler.tryExecute({ event, state, attempt: 0 });
 * if (!ran.ok) ran.error.retry;                    // redeliver, or do not
 * else if (ran.value.kind === 'produced') ran.value.events;
 *
 * // Throwing it instead.
 * const done = await handler.execute({ event, state, attempt: 0 });
 * if (done.kind === 'produced') done.state;        // the record to commit
 * ```
 */
export class ArvoEventHandler<
  TSelf extends ArvoContract = ArvoContract,
  TServices extends ArvoServiceMap = ArvoServiceMap,
  TDependencies extends ArvoDependencies = ArvoNone,
  TMechanismHooks extends ArvoMechanismHooks = ArvoNone,
> {
  /** What this handler is bound to: what it implements, and what it may send to. */
  readonly contracts: {
    readonly self: TSelf;
    readonly services: Readonly<TServices>;
  };

  /** Every option this handler holds, which each version falls back to. */
  readonly options: ArvoEventHandlerOptions;

  /** Every version of the contract, reachable by the version it runs. */
  readonly versions: ArvoVersionMap<
    TSelf,
    TServices,
    TDependencies,
    TMechanismHooks
  >;

  /**
   * Where this handler's executions record.
   *
   * Each is a no-op where nothing was declared for it, so a deployment
   * collecting nothing costs nothing.
   */
  readonly telemetry: {
    readonly tracer: Tracer;
    readonly meter: Meter | null;
    readonly logger: ArvoLogger | null;
  };

  /** What judges an arriving event against the contracts declared. */
  readonly #events: ArvoEventValidator<TSelf, TServices>;

  /**
   * Judges a finished declaration and holds what it accepted.
   *
   * Not the way to declare a handler: `setupArvoEventHandler` begins one
   * and `build` finishes it, which is what reaches this.
   *
   * @param setup - The declaration, with every version on it.
   * @throws {ArvoEventHandlerValidationError} Where the declaration
   * breaks any rule, naming every rule it broke.
   */
  constructor(
    setup: ArvoEventHandlerSetup<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >,
  ) {
    const contract = setup.contracts.self;
    const services = setup.contracts.services;

    const unreadable = checkContract(contract);
    if (unreadable.length > 0) {
      throw new ArvoEventHandlerValidationError(unreadable);
    }

    const handlerOptions = resolveOptions(
      setup.options,
      ARVO_DEFAULT_HANDLER_OPTIONS,
    );

    const issues: ErrorIssue[] = [
      ...checkOptions(setup.options, 'options'),
      ...checkVersions(
        contract,
        setup.versions.map((declared) => declared.version),
      ),
      ...checkServices(services),
      ...checkCollisions(contract, services),
    ];

    const optionsByVersion = new Map<string, ArvoEventHandlerOptions>();
    for (const declared of setup.versions) {
      const declaredAt = `versions${pathSegmentForKey(declared.version)}`;
      issues.push(...checkOptions(declared.options, `${declaredAt}.options`));

      const inForce = resolveOptions(declared.options, handlerOptions);
      issues.push(...checkTimeouts(inForce, declaredAt));
      optionsByVersion.set(declared.version, inForce);
    }

    if (issues.length > 0) throw new ArvoEventHandlerValidationError(issues);

    const versions = new Map<string, ArvoEventHandlerVersion>();
    for (const declared of setup.versions) {
      versions.set(
        declared.version,
        new ArvoEventHandlerVersion({
          contracts: {
            self: contract.versions[
              declared.version as keyof TSelf['versions'] & ArvoSemanticVersion
            ],
            services,
          },
          // every version was judged above, so each has one in force
          options: optionsByVersion.get(
            declared.version,
          ) as ArvoEventHandlerOptions,
          state: declared.state,
          declaresState: declared.declaresState,
          execute: declared.execute,
        }),
      );
    }

    this.contracts = Object.freeze({
      self: contract,
      services: Object.freeze({ ...services }),
    });
    this.options = Object.freeze(handlerOptions);
    this.telemetry = Object.freeze({
      tracer:
        setup.telemetry?.tracer ??
        trace.getTracer(contract.type, ARVO_RECORD_FORMAT_VERSION),
      meter: setup.telemetry?.meter ?? null,
      logger: setup.telemetry?.logger ?? null,
    });
    this.#events = new ArvoEventValidator({
      contracts: { self: contract, services },
    });
    this.versions = versions as unknown as ArvoVersionMap<
      TSelf,
      TServices,
      TDependencies,
      TMechanismHooks
    >;
    Object.freeze(this);
  }

  /**
   * One execution, from the event that caused it to what is to be
   * published and committed — reporting a fault rather than throwing.
   *
   * Opens a span continuing the trace the event arrived on, works through
   * every check that must pass before business code runs, and hands the
   * execution to the version that owns it.
   *
   * Three ways out, and they are the three a mechanism acts on.
   * `produced` says these events and this record go together, to be
   * committed as one or not at all. `discarded` says this event had
   * already been processed and there is nothing to do. A fault says
   * nothing was concluded: nothing to publish and nothing to commit, only
   * what it would take to give up, and whether another attempt is worth
   * making.
   *
   * The work failing is none of the three. An executor that cannot finish
   * comes back as `produced`, carrying this contract's handler error
   * event for the caller and a record resting at `error`.
   *
   * @param param - What this execution brings with it.
   * @returns What to publish and commit, that there is nothing to do, or
   * the fault that says why neither.
   *
   * @example
   * ```typescript
   * declare const handler: ArvoEventHandler<typeof orderContract>;
   *
   * const ran = await handler.tryExecute({ event, state, attempt: 0 });
   * if (!ran.ok) ran.error.retry;            // redeliver, or do not
   * else if (ran.value.kind === 'produced') ran.value.events;
   * ```
   */
  async tryExecute(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
  ): AsyncResult<ArvoEventHandlerExecuteResponse, ArvoHandlerFault> {
    const joined = continueTraceFromEvent(
      param.event,
      this.telemetry.tracer,
      `${this.contracts.self.type}.execute`,
    );
    const span =
      joined?.span ??
      this.telemetry.tracer.startSpan(`${this.contracts.self.type}.execute`);
    const telemetry = new ArvoExecutionContextTelemetry({
      span,
      meter: this.telemetry.meter,
      logger: this.telemetry.logger,
    });

    try {
      return fromNeverthrow(ok(await this.#run(param, telemetry)));
    } catch (raised) {
      if (raised instanceof ArvoHandlerFault)
        return fromNeverthrow(err(raised));
      // Not a fault, so reporting it here would make the error type say
      // something untrue about what went wrong.
      throw raised;
    } finally {
      span.end();
    }
  }

  /**
   * One execution, from the event that caused it to what is to be
   * published and committed — throwing a fault rather than reporting it.
   *
   * What {@link tryExecute} does, for a caller that would rather catch.
   *
   * @param param - What this execution brings with it.
   * @returns What to publish and commit, or that there is nothing to do.
   * @throws {ArvoHandlerFault} Where nothing could be concluded.
   *
   * @example
   * ```typescript
   * declare const handler: ArvoEventHandler<typeof orderContract>;
   *
   * const ran = await handler.execute({ event, state, attempt: 0 });
   * if (ran.kind === 'produced') ran.events;
   * ```
   */
  async execute(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const ran = await this.tryExecute(param);
    if (ran.ok) return ran.value;
    throw ran.error;
  }

  /** Every check that must pass, in order, and then the version itself. */
  async #run(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const placed = this.#resolve(param.event);
    if ('faultKind' in placed) {
      throw await this.#refuseUnresolved(param, telemetry, placed);
    }
    const resolved = placed;
    markEntryStage(telemetry, 'event_resolved');

    const miscategorised = refuseMiscategorised(resolved, param.event);
    if (miscategorised !== null) {
      throw await this.#refuse(
        param,
        telemetry,
        resolved,
        null,
        miscategorised,
      );
    }
    markEntryStage(telemetry, 'category_agreed');

    const executionId = await this.#identify(resolved, param.event);
    describeEntry(telemetry, {
      event: param.event,
      entry: resolved.entry,
      executionId,
      attempt: param.attempt,
    });

    const stored = await this.#fetch(param, telemetry, resolved, executionId);
    markEntryStage(telemetry, 'record_fetched');

    const absent = refuseMismatchedPresence(resolved, executionId, stored);
    if (absent !== null) {
      throw await this.#refuse(param, telemetry, resolved, null, absent);
    }

    if (resolved.entry === 'init') {
      return this.#dispatch(param, telemetry, resolved, executionId, null);
    }

    // Nothing may be read off a stored row until it is established to be
    // a record: a field read off something else reports a mismatch where
    // the truth is corruption.
    const record = await this.#hydrate(
      param,
      telemetry,
      resolved,
      executionId,
      stored as JSONObject,
    );
    markEntryStage(telemetry, 'record_hydrated');

    const withdrawn = refuseWithdrawnVersion(
      new Set(this.versions.keys()),
      record.version,
      this.contracts.self.type,
    );
    if (withdrawn !== null) {
      throw await this.#refuse(
        param,
        telemetry,
        resolved,
        record,
        withdrawn,
        this.contracts.self.versions[
          record.version as keyof TSelf['versions'] & ArvoSemanticVersion
        ],
      );
    }
    markEntryStage(telemetry, 'version_resolved');

    return this.#dispatch(
      param,
      telemetry,
      resolved,
      executionId,
      stored as JSONObject,
      record.version,
    );
  }

  /**
   * Which contract the event belongs to, and whether it opens an
   * execution of this one or answers one.
   *
   * Read from `dataschema`, which names one contract at one version, and
   * never from the type alone, which names neither reliably.
   */
  #resolve(event: ArvoEvent): ArvoResolvedEntry | ArvoGateRefusal {
    const origin = this.#events.resolveInput(event);
    if (!origin.ok) {
      return {
        faultKind: origin.error.faultKind,
        message: origin.error.message,
        violations: origin.error.issues.map((issue) => issue.toString()),
      };
    }
    return {
      entry: origin.value.source === 'self' ? 'init' : 'followup',
      version: origin.value.version,
      contract: origin.value.contract,
    };
  }

  /** The execution this event concerns, derived or carried. */
  async #identify(
    resolved: ArvoResolvedEntry,
    event: ArvoEvent,
  ): Promise<string> {
    return resolved.entry === 'init'
      ? await deriveArvoExecutionId(event)
      : event.executionid;
  }

  /** What the store holds under that identifier, read once. */
  async #fetch(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
    resolved: ArvoResolvedEntry,
    executionId: string,
  ): Promise<JSONObject | null> {
    try {
      return await param.state({
        executionId,
        telemetry,
        attempt: param.attempt,
      });
    } catch (raised) {
      throw await this.#refuse(param, telemetry, resolved, null, {
        faultKind: 'state_resolution_failed',
        message: `the store could not be read for ${executionId}, so nothing says whether this execution exists. Another attempt may reach it`,
        violations: [],
        cause: raised instanceof Error ? raised.message : String(raised),
      });
    }
  }

  /**
   * The stored row established to be a record, with every event it holds
   * restored.
   *
   * Its own data is held opaque here: the schema governing it belongs to
   * the version that owns the record, and which version that is cannot be
   * trusted until this has passed.
   */
  async #hydrate(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
    resolved: ArvoResolvedEntry,
    executionId: string,
    stored: JSONObject,
  ): Promise<ArvoExecutionState> {
    const restored = await createFollowupArvoExecutionState({
      dataSchema: ARVO_ANY_STATE_SCHEMA,
      event: param.event,
      state: stored,
      executionId,
    });
    if (restored.ok) return restored.value;

    // A record can fail to restore for two reasons, and only one of them
    // carries the rules it broke; the other is a row that could not be
    // read at all, which nothing here can produce since the schema it is
    // read under is always supplied.
    const issues =
      restored.error instanceof ArvoExecutionStateValidationError
        ? restored.error.issues
        : [];

    throw await this.#refuse(param, telemetry, resolved, null, {
      // An event the record holds failing to restore is a different
      // diagnosis from a record whose shape is wrong, and a field the row
      // never carried is the second rather than the first.
      faultKind: issues.some((issue) => {
        const field = String(issue.path).split(/[.[]/)[0] as string;
        return (
          ['initEvent', 'triggeringEvent', 'inFlightEventMap'].includes(
            field,
          ) && field in stored
        );
      })
        ? 'record_event_unrestorable'
        : 'record_invalid',
      message: `the stored state under ${executionId} could not be read back as a record of ${this.contracts.self.type}: ${restored.error.message}`,
      violations: issues.map((issue) => issue.toString()),
      cause: restored.error.message,
    });
  }

  /** The version that owns this execution, running it. */
  async #dispatch(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
    resolved: ArvoResolvedEntry,
    executionId: string,
    stored: JSONObject | null,
    owning?: ArvoSemanticVersion,
  ): Promise<ArvoEventHandlerExecuteResponse> {
    const version = this.versions.get(
      (owning ?? resolved.version) as keyof TSelf['versions'] &
        ArvoSemanticVersion,
    );

    return version.execute({
      entry: resolved.entry,
      event: param.event,
      state: stored,
      executionId,
      attempt: param.attempt,
      dependencies: param.dependencies ?? ({} as TDependencies),
      hooks: param.hooks ?? ({} as TMechanismHooks),
      telemetry,
      // Judged where the protocol puts it: after the record has had its
      // say about depth, lifecycle, time and addressing, so a late event
      // is refused for being late rather than for what it carries.
      checkEvent: () =>
        this.#checkEvent(param.event, {
          source: resolved.entry === 'init' ? 'self' : 'service',
          version: resolved.version,
          contract: resolved.contract,
        }),
    } as Parameters<typeof version.execute>[0]);
  }

  /** Whether the event is one the contract it named can send here. */
  #checkEvent(
    event: ArvoEvent,
    origin: ArvoEventOrigin,
  ): ArvoGateRefusal | null {
    const refused = this.#events.checkInput(event, origin);
    if (refused === null) return null;
    return {
      faultKind: refused.faultKind,
      message: refused.message,
      violations: refused.issues.map((issue) => issue.toString()),
    };
  }

  /**
   * A refusal of an event nothing could place.
   *
   * It names no execution and carries nothing to abandon with: until the
   * event is placed there is no execution to name and nobody to tell.
   */
  async #refuseUnresolved(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
    refusal: ArvoGateRefusal,
  ): Promise<ArvoHandlerFault> {
    return createArvoHandlerFault({
      contracts: { self: this.#anyVersion() },
      options: this.options,
      attempt: param.attempt,
      telemetry,
      faultKind: refusal.faultKind,
      message: refusal.message,
      violations: refusal.violations,
      state: null,
      event: param.event,
      initEvent: null,
      executionId: null,
    });
  }

  /** A refusal of this execution, as the fault a mechanism acts on. */
  async #refuse(
    param: ArvoEventHandlerExecuteParam<TDependencies, TMechanismHooks>,
    telemetry: ArvoExecutionContextTelemetry,
    resolved: ArvoResolvedEntry,
    record: ArvoExecutionState | null,
    refusal: ArvoGateRefusal,
    owning?: VersionedArvoContract,
  ): Promise<ArvoHandlerFault> {
    const self =
      owning ??
      (resolved.entry === 'init'
        ? this.contracts.self.versions[
            resolved.version as keyof TSelf['versions'] & ArvoSemanticVersion
          ]
        : this.#anyVersion());

    // An event opening an execution names its own version, so that
    // version's options are in force. Anything else is refused before the
    // record has said which version owns it — including a version this
    // handler no longer runs — and the rule with nothing on the version
    // side is the handler's own values.
    const options =
      resolved.entry === 'init' && owning === undefined
        ? this.versions.get(
            self.version as keyof TSelf['versions'] & ArvoSemanticVersion,
          ).options
        : this.options;

    const shared = {
      contracts: { self },
      options,
      attempt: param.attempt,
      telemetry,
      faultKind: refusal.faultKind,
      message: refusal.message,
      violations: refusal.violations,
      cause: refusal.cause,
      retryable: refusal.retryable,
    };

    if (record !== null) {
      return createArvoHandlerFault({
        ...shared,
        state: record,
        entry: resolved.entry,
      });
    }

    return createArvoHandlerFault({
      ...shared,
      state: null,
      event: param.event,
      executionId: await this.#identify(resolved, param.event),
      // An event opening an execution carries where it came from, so its
      // caller can be told. One answering an execution names the service
      // that sent it and nothing of this execution's own caller, so until
      // the record is read there is nobody to address.
      initEvent: resolved.entry === 'init' ? param.event : null,
    });
  }

  /**
   * Any version of the contract, for a refusal raised before one is
   * known.
   *
   * Only ever read for the contract's `type`, which every version agrees
   * on. A refusal reaching this has no record and no opening event, so no
   * event is addressed from it.
   */
  #anyVersion(): VersionedArvoContract {
    return Object.values(
      this.contracts.self.versions,
    )[0] as VersionedArvoContract;
  }
}
