import type { VersionedArvoContract } from '../ArvoContract/versioned/index.js';
import type { ArvoEvent } from '../ArvoEvent/index.js';
import type { ArvoSemanticVersion } from '../semver/index.js';
import type { JSONObject } from '../types.js';
import type { ArvoEntryKind } from './context/types.js';
import {
  ARVO_CATEGORY_COMPLETE,
  ARVO_CATEGORY_INIT,
} from './helpers/defaults.js';
import type { ArvoGateRefusal } from './version/types.js';

/**
 * What an arriving event was resolved to: whether it opens an execution
 * or answers one, and the version its own `dataschema` named.
 */
export type ArvoResolvedEntry = {
  /** Whether this opens an execution of the contract, or answers one. */
  readonly entry: ArvoEntryKind;
  /** The version the event named, which is its own contract's. */
  readonly version: ArvoSemanticVersion;
  /** That contract at that version, which says what the event may be. */
  readonly contract: VersionedArvoContract;
};

/** What an event of each kind states itself to be. */
const CATEGORY_BY_ENTRY: Record<ArvoEntryKind, string> = {
  init: ARVO_CATEGORY_INIT,
  followup: ARVO_CATEGORY_COMPLETE,
};

/** Every category that carries a meaning, so an unknown one is ignorable. */
const RESERVED_CATEGORIES: ReadonlySet<string> = new Set([
  ARVO_CATEGORY_INIT,
  ARVO_CATEGORY_COMPLETE,
]);

/**
 * Why an event's own statement of its role contradicts what it was
 * resolved to.
 *
 * A sender states its role in `category`, and a receiver resolves one
 * from the contract the event names. Where both are present and they
 * disagree, two independently deployed participants have diverged about
 * what they are doing, and no redelivery of this event changes that.
 *
 * Only the two reserved values are consulted: anything else, absence
 * included, states nothing to contradict.
 *
 * @param resolvedEntry - What the event was resolved to.
 * @param event - The event that arrived.
 * @returns Why it is refused, or `null` where it is not.
 */
export const refuseMiscategorised = (
  resolvedEntry: ArvoResolvedEntry,
  event: ArvoEvent,
): ArvoGateRefusal | null => {
  const statedCategory = event.category;
  if (statedCategory === null || !RESERVED_CATEGORIES.has(statedCategory))
    return null;

  const expectedCategory = CATEGORY_BY_ENTRY[resolvedEntry.entry];
  if (statedCategory === expectedCategory) return null;

  return {
    faultKind: 'category_mismatch',
    message: `${event.type} states it is ${statedCategory}, and ${event.dataschema} makes it ${expectedCategory} — whoever sent it and whoever received it disagree about what it is doing, which no further attempt reconciles`,
    violations: [
      `category: must be ${expectedCategory} for an event ${resolvedEntry.entry === 'init' ? 'opening' : 'answering'} an execution, received ${statedCategory}`,
    ],
  };
};

/**
 * Why what the store held does not match what the event claims.
 *
 * An event opening an execution must find none under the identifier it
 * derives, or a repeat of it would open a second. One answering an
 * execution must find the one it names, and an execution this handler has
 * no memory of is not resumed by asking again.
 *
 * @param resolvedEntry - What the event was resolved to.
 * @param executionId - The identifier the store was asked under.
 * @param storedRecord - What the store held, or `null` where it held nothing.
 * @returns Why it is refused, or `null` where it is not.
 */
export const refuseMismatchedPresence = (
  resolvedEntry: ArvoResolvedEntry,
  executionId: string,
  storedRecord: JSONObject | null,
): ArvoGateRefusal | null => {
  if (resolvedEntry.entry === 'init') {
    if (storedRecord === null) return null;
    return {
      faultKind: 'record_unexpected',
      message: `an execution already exists under ${executionId}, and this event opens one — so it has been seen before, and opening a second would fork the work`,
      violations: [],
    };
  }

  if (storedRecord !== null) return null;
  return {
    faultKind: 'record_expected',
    message: `nothing is stored under ${executionId}, and this event answers an execution — so there is no execution to resume, and no further attempt produces one`,
    violations: [],
  };
};

/**
 * Why a stored execution can no longer be run.
 *
 * A version leaves a handler by leaving its contract, and its executor
 * with it. Executions already open at that version are then stranded:
 * nothing is left that knows what their state means or what they may
 * emit, and running a neighbouring version over them would corrupt them
 * rather than resume them.
 *
 * @param declaredVersions - Every version this handler still runs.
 * @param version - The version the stored execution belongs to.
 * @param contractType - What a refusal names the contract by.
 * @returns Why it is refused, or `null` where it is not.
 */
export const refuseWithdrawnVersion = (
  declaredVersions: ReadonlySet<string>,
  version: string,
  contractType: string,
): ArvoGateRefusal | null => {
  if (declaredVersions.has(version)) return null;

  return {
    faultKind: 'version_not_declared',
    message: `this execution belongs to ${contractType}@${version}, which this handler no longer declares, so nothing is left that could resume it. A version is drained before it is removed; these executions were still open when it went`,
    violations: [
      `version: must be one of ${[...declaredVersions].join(', ')}, received ${version}`,
    ],
  };
};
