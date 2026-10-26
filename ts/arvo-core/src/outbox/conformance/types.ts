import type { IArvoOutbox } from '../../ArvoOutbox/interface.js';
import type { PromiseAble } from '../../types.js';

/**
 * One rule every outbox meets, as a check you can run against yours.
 *
 * `check` fails, through vitest's `expect`, where the outbox it is given
 * breaks the rule `name` states. Give it a fresh, empty outbox: it reasons
 * about everything the outbox holds.
 *
 * @example
 * ```typescript
 * const conformanceCase: ArvoOutboxConformanceCase = {
 *   name: 'returns no state for an execution never committed',
 *   check: async (outbox) => {
 *     expect(await outbox.readLatestState(crypto.randomUUID())).toBeNull();
 *   },
 * };
 * ```
 */
export type ArvoOutboxConformanceCase = {
  /** The rule, as a sentence. */
  readonly name: string;
  /** Fails where `outbox` breaks the rule. */
  readonly check: (outbox: IArvoOutbox) => Promise<void>;
};

/**
 * How the conformance kit gets the outboxes it checks.
 *
 * Every call of `createOutbox` must return a new, empty outbox that shares
 * nothing with any other: a new instance, a new file, or a new schema. A
 * case listing unseen events counts everything the outbox holds, so one
 * left over from another case fails it.
 *
 * Add checks of your own, such as rules your outbox holds beyond these,
 * through `additionalCases`. They run after the kit's own, in the same
 * suite, each given a new outbox in the same way.
 *
 * The kit closes nothing. Where your outbox holds a connection or a file,
 * keep each one `createOutbox` returns and close them when the suite ends.
 *
 * @example
 * ```typescript
 * const param: ArvoOutboxConformanceParam = {
 *   createOutbox: async () => PostgresOutbox.open(await createEmptySchema()),
 *   additionalCases: [
 *     {
 *       name: 'keeps every state in its own schema',
 *       check: async (outbox) => {
 *         // fails where the outbox breaks the rule
 *       },
 *     },
 *   ],
 * };
 * ```
 */
export type ArvoOutboxConformanceParam = {
  /** A new, empty outbox, directly or through a promise. */
  readonly createOutbox: () => PromiseAble<IArvoOutbox>;
  /** Checks of your own, run after the kit's. */
  readonly additionalCases?: readonly ArvoOutboxConformanceCase[];
};
