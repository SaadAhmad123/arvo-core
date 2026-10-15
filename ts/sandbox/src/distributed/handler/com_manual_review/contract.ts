import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * Work nothing in the lattice can do.
 *
 * The contract carries a `domain`, so an event built from it leaves the
 * ordinary path and no handler here is given it. Only something outside
 * can answer — a signal in Temporal, an awaited event in DBOS — and
 * until it does, the execution that asked rests at `waiting`, which is
 * what waiting means.
 */
export const manualReviewContract = createArvoContract({
  type: 'com_manual_review',
  description: 'Asks a person, who may take as long as they like.',
  domain: 'human_review',
  versions: {
    '1.0.0': {
      input: z.object({
        orderRef: z.string().min(1),
        because: z.string().min(1),
      }),
      outputs: {
        evt_review_decided: z.object({
          approved: z.boolean(),
          by: z.string(),
        }),
      },
    },
  },
});

export const manualReviewV1 = manualReviewContract.versions['1.0.0'];
