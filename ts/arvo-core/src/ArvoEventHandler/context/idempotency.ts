/**
 * Keys an executor hands to something outside Arvo that accepts one.
 *
 * Composed exactly as `docs/adr/014-idempotency-keys.md` pins them, so
 * two implementations in two languages produce the same key for the same
 * execution. Every part of that composition is fixed; an implementation
 * differing on any of it produces an effect made twice at a third party.
 */

/** What the composition and its version are called in every key. */
const KEY_PREFIX = 'arvo';

/** The scopes, which are also the first part of each hashed input. */
const WORKFLOW = 'workflow';
const EXECUTION = 'execution';
const DELIVERY = 'delivery';

/**
 * What an executor is given, one key per scope.
 *
 * Each is the same for everything its scope covers and different for
 * everything outside it. None is keyed on the attempt: a key that
 * changed per attempt would identify the attempt rather than the work,
 * which is the opposite of what these are for.
 */
export type ArvoIdempotencyKeys = {
  /**
   * The same for every execution of one workflow, at every depth.
   *
   * For an effect that must happen once per workflow, wherever in the
   * workflow it is decided.
   */
  readonly workflow: string;
  /**
   * The same for every delivery and every attempt of one execution, and
   * held by no other execution — including another of the same contract
   * at the same version.
   *
   * Constant across suspension of any length, so an effect keyed on it
   * happens once however long the execution lasts.
   */
  readonly execution: string;
  /**
   * The same for every attempt of one delivery, and where the event that
   * caused it is delivered again.
   *
   * For an effect an execution makes once per event it receives.
   */
  readonly delivery: string;
};

/** What each key is composed from. */
export type ArvoIdempotencyParts = {
  /** The workflow this execution belongs to. */
  subject: string;
  /** This execution. */
  executionId: string;
  /** The event that caused this delivery. */
  deliveredEventId: string;
};

/** The byte that separates the parts of a hashed input. */
const PART_SEPARATOR = 0x00;

/**
 * One hashed input, as the pinned composition builds it.
 *
 * The scope's name goes in first, which is what stops two scopes
 * producing one key where a subject happens to equal an execution's
 * identifier. `0x00` separates the parts: ADR-002 excludes it from
 * `subject` and `id`, and an execution identifier is hexadecimal, so it
 * cannot occur inside any part — without it, two different pairs could
 * form one string.
 */
const digestInputFor = (
  scope: string,
  keyParts: readonly string[],
): Uint8Array<ArrayBuffer> => {
  const encoder = new TextEncoder();
  const encodedParts = [scope, ...keyParts].map((keyPart) =>
    encoder.encode(keyPart),
  );
  const separatorCount = encodedParts.length - 1;

  const digestInput = new Uint8Array(
    new ArrayBuffer(
      encodedParts.reduce(
        (byteLength, encodedPart) => byteLength + encodedPart.length,
        separatorCount,
      ),
    ),
  );

  let offset = 0;
  for (const [position, encodedPart] of encodedParts.entries()) {
    if (position > 0) {
      digestInput[offset] = PART_SEPARATOR;
      offset += 1;
    }
    digestInput.set(encodedPart, offset);
    offset += encodedPart.length;
  }

  return digestInput;
};

/** One key, hashed and rendered as the composition fixes it. */
const idempotencyKeyFor = async (
  scope: string,
  keyParts: readonly string[],
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    digestInputFor(scope, keyParts),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');

  return `${KEY_PREFIX}-${scope}-${hex}`;
};

/**
 * The three keys for one delivery.
 *
 * Derived from what the record and the delivered event already carry, so
 * nothing is stored and carrying out the same events again produces the
 * same keys.
 *
 * @param parts - The workflow, the execution, and the event that caused
 * this delivery.
 *
 * @example
 * ```typescript
 * const keys = await arvoIdempotencyKeysFor({
 *   subject: state.subject,
 *   executionId: state.executionId,
 *   deliveredEventId: state.triggeringEvent.id,
 * });
 * keys.execution; // 'arvo-execution-<64 hex>'
 * ```
 */
export const arvoIdempotencyKeysFor = async (
  idempotencyParts: ArvoIdempotencyParts,
): Promise<ArvoIdempotencyKeys> => {
  const [workflow, execution, delivery] = await Promise.all([
    idempotencyKeyFor(WORKFLOW, [idempotencyParts.subject]),
    idempotencyKeyFor(EXECUTION, [idempotencyParts.executionId]),
    idempotencyKeyFor(DELIVERY, [
      idempotencyParts.executionId,
      idempotencyParts.deliveredEventId,
    ]),
  ]);

  return Object.freeze({ workflow, execution, delivery });
};
