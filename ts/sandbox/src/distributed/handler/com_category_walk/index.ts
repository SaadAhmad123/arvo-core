import { setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import type { DistributedDependencies } from '../dependencies.js';
import { categoryWalkContract, categoryWalkV1 } from './contract.js';

/**
 * Work that calls itself.
 *
 * One execution per node. On the way down it asks the catalogue for a
 * node's children and opens an execution of itself for each, then
 * waits. On the way up it adds what they found to what it found and
 * answers whoever asked.
 *
 * Three things meet here that meet nowhere else in the run.
 *
 * A request to this contract and a reply from it carry the same
 * `dataschema`, so only the event's type says which is which — the one
 * overlap the protocol has, and the thing a mechanism is most likely to
 * get wrong.
 *
 * Depth is enforced rather than assumed: `atMaxDepth` is read before
 * deciding to descend, so a branch that cannot go deeper answers
 * instead of raising. An execution that ignored it would be refused on
 * what it returned, which is the stricter of the two checks.
 *
 * And a leaf answers without ever having waited, so a mechanism sees
 * both an execution that suspends and one that does not, under one
 * contract.
 */
export const categoryWalkHandler = setupArvoEventHandler({
  contracts: {
    self: categoryWalkContract,
    // itself, which is how a handler recurses
    services: { deeper: categoryWalkV1 },
  },
  types: {} as { dependencies: DistributedDependencies },
  options: {
    runTimeout: 15_000,
    maxRetryAttempts: 3,
    // Deliberately low enough that a deep run reaches it. A bound
    // nothing ever hits is a bound nothing has tested.
    maxDepth: 12,
  },
})
  .handler('1.0.0', {
    state: z.object({
      category: z.string(),
      /** How many nodes this branch has accounted for, itself included. */
      visited: z.number(),
      /** The deepest level anything under here reached. */
      deepest: z.number(),
    }),
    execute: async (ctx) => {
      const asked = ctx.state.initEvent.data;

      // ------------------------------------------------- on the way down
      if (ctx.entry === 'init') {
        const children =
          asked.remaining > 0
            ? await ctx.dependencies.catalogue.childrenOf(asked.category)
            : [];

        // A branch that may not descend answers for itself rather than
        // asking and being refused: the protocol offers this precisely
        // so that reaching a bound is a decision rather than a fault.
        const descending = ctx.atMaxDepth ? [] : children;

        if (ctx.atMaxDepth && children.length > 0) {
          ctx.telemetry.logger.warn('stopped at the bound rather than past it', {
            category: asked.category,
            depth: ctx.state.depth,
            abandonedChildren: children.length,
          });
        }

        await ctx.setState({
          data: {
            category: asked.category,
            visited: 1,
            deepest: ctx.state.depth,
          },
        });

        if (descending.length === 0) {
          // a leaf: it answers without ever having waited
          return ctx.build({
            type: 'evt_category_walked',
            data: {
              category: asked.category,
              visited: 1,
              deepest: ctx.state.depth,
            },
          });
        }

        return Promise.all(
          descending.map((child) =>
            ctx.build({
              type: 'com_category_walk',
              data: { category: child, remaining: asked.remaining - 1 },
            }),
          ),
        );
      }

      // --------------------------------------------------- on the way up
      // Every child has answered, because this version joins on all of
      // them: `collected` is complete or the executor was not entered.
      let visited = 1;
      let deepest = ctx.state.depth;

      for (const answer of ctx.state.inFlightEventMap.values()) {
        if (answer === null) continue;
        if (answer.type !== 'evt_category_walked') continue;

        const found = answer.data as { visited: number; deepest: number };
        visited += found.visited;
        deepest = Math.max(deepest, found.deepest);
      }

      await ctx.setState({
        data: { category: asked.category, visited, deepest },
      });

      ctx.telemetry.logger.info('walked', {
        category: asked.category,
        visited,
        deepest,
      });

      return ctx.build({
        type: 'evt_category_walked',
        data: { category: asked.category, visited, deepest },
      });
    },
  })
  .build();
