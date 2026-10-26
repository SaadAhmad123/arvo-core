import type { ArvoOutboxUnseenEventsParam } from '../../../ArvoOutbox/types/read.js';

/** Lists every unseen event a case commits, however recent. */
export const listEveryUnseenEvent: ArvoOutboxUnseenEventsParam = {
  atMost: 1000,
  olderThanMs: 0,
};

/** Lists no event a case has just committed. */
export const listNothingRecent: ArvoOutboxUnseenEventsParam = {
  atMost: 1000,
  olderThanMs: 24 * 60 * 60 * 1000,
};
