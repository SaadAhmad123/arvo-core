import { createArvoContract } from 'arvo-core';
import { z } from 'zod';

/**
 * Work that calls itself.
 *
 * One execution per node of a category tree, each opening children of
 * its own and answering once they have all answered. Depth, recursion
 * and the depth bound are one handler, because they are one problem: an
 * execution that does not know how deep it already is cannot know
 * whether it may go deeper.
 *
 * A request to this contract and a reply from it carry the same
 * `dataschema`, so only the event's type says which is which. That is
 * the one overlap the protocol has, and this is where a mechanism meets
 * it.
 */
export const categoryWalkContract = createArvoContract({
  type: 'com_category_walk',
  description: 'Walks a category and everything under it.',
  versions: {
    '1.0.0': {
      input: z.object({
        category: z.string().min(1),
        /** How much further this branch may descend before it stops. */
        remaining: z.number().int().nonnegative(),
      }),
      outputs: {
        evt_category_walked: z.object({
          category: z.string(),
          visited: z.number().int().positive(),
          deepest: z.number().int().nonnegative(),
        }),
      },
    },
  },
});

export const categoryWalkV1 = categoryWalkContract.versions['1.0.0'];
