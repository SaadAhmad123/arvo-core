import type { ArvoOutboxConformanceCase } from '../types.js';
import { commitIsStampedWhenLandedCases } from './commit-is-stamped-when-landed.js';
import { commitLandsWholeCases } from './commit-lands-whole.js';
import { committedEventIsIgnoredCases } from './committed-event-is-ignored.js';
import { eventsAreReadByFilterCases } from './events-are-read-by-filter.js';
import { eventsCommitWithoutStateCases } from './events-commit-without-state.js';
import { firstRevisionNeedsNothingStoredCases } from './first-revision-needs-nothing-stored.js';
import { laterRevisionFollowsStoredCases } from './later-revision-follows-stored.js';
import { latestStateIsReadLiveCases } from './latest-state-is-read-live.js';
import { listingWithALeaseCases } from './listing-with-a-lease.js';
import { markingSeenIsFinalCases } from './marking-seen-is-final.js';
import { nothingIsReadOffTheStateCases } from './nothing-is-read-off-the-state.js';
import { payloadIsKeptByteForByteCases } from './payload-is-kept-byte-for-byte.js';
import { refusalIsAnsweredCases } from './refusal-is-answered.js';
import { stateIsReturnedUnchangedCases } from './state-is-returned-unchanged.js';
import { unseenEventsAreListedOldestFirstCases } from './unseen-events-are-listed-oldest-first.js';

/**
 * Every rule an outbox meets that holds whatever its clock, as a check you
 * can run in any test runner.
 *
 * Give each case a new, empty outbox. Each case names the rule it checks
 * and fails, through vitest's `expect`, where the outbox breaks it.
 *
 * @example
 * ```typescript
 * for (const conformanceCase of arvoOutboxConformanceCases) {
 *   test(conformanceCase.name, async () => {
 *     await conformanceCase.check(await createEmptyOutbox());
 *   });
 * }
 * ```
 */
export const arvoOutboxConformanceCases: readonly ArvoOutboxConformanceCase[] =
  [
    ...latestStateIsReadLiveCases,
    ...stateIsReturnedUnchangedCases,
    ...nothingIsReadOffTheStateCases,
    ...commitLandsWholeCases,
    ...firstRevisionNeedsNothingStoredCases,
    ...laterRevisionFollowsStoredCases,
    ...refusalIsAnsweredCases,
    ...eventsCommitWithoutStateCases,
    ...committedEventIsIgnoredCases,
    ...payloadIsKeptByteForByteCases,
    ...commitIsStampedWhenLandedCases,
    ...eventsAreReadByFilterCases,
    ...unseenEventsAreListedOldestFirstCases,
    ...listingWithALeaseCases,
    ...markingSeenIsFinalCases,
  ];
