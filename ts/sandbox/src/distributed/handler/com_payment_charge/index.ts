import { setupArvoEventHandler } from 'arvo-core';
import { z } from 'zod';
import type { DistributedDependencies } from '../dependencies.js';
import { HANDLER_TELEMETRY } from '../telemetry.js';
import { paymentChargeContract } from './contract.js';

/**
 * Work that fails and then does not.
 *
 * It refuses while the attempt number is below what the order asked
 * for, and succeeds after. Keyed on the attempt rather than on what it
 * remembers, deliberately: a mechanism that loses count of attempts, or
 * that counts from a different number than the protocol does, produces
 * a charge that either never succeeds or succeeds on its first try.
 * Both are visible here and nowhere else.
 *
 * It refuses by raising a fault rather than by failing, because the
 * delivery is what was compromised rather than the work: a gateway that
 * did not answer this time may answer next time, and the caller should
 * not be told the charge failed while it is still being attempted.
 */
export const paymentChargeHandler = setupArvoEventHandler({
  contracts: { self: paymentChargeContract },
  types: {} as { dependencies: DistributedDependencies },
  telemetry: HANDLER_TELEMETRY,
  options: {
    runTimeout: 10_000,
    // enough that a charge asking for two failures still succeeds, and
    // few enough that one asking for ten is abandoned
    maxRetryAttempts: 5,
    retryDelay: (_event, _state, attempt) => 100 * (attempt + 1),
  },
})
  .handler('1.0.0', {
    state: z.object({
      receipt: z.string(),
      attempts: z.number(),
    }),
    execute: async (ctx) => {
      const requested = ctx.state.initEvent.data;

      if (ctx.attempt < requested.failuresBeforeSuccess) {
        ctx.telemetry.logger.warn('the gateway did not answer', {
          attempt: ctx.attempt,
          needed: requested.failuresBeforeSuccess,
        });

        throw await ctx.fault({
          faultKind: 'executor_raised',
          message: `the payment gateway did not answer on attempt ${ctx.attempt}, and may on the next`,
          retryable: true,
        });
      }

      const receipt = `receipt-${ctx.state.subject}-${requested.amount}`;
      await ctx.setState({ data: { receipt, attempts: ctx.attempt } });

      ctx.telemetry.logger.info('charged', {
        receipt,
        attempt: ctx.attempt,
      });

      return ctx.build({
        type: 'evt_payment_charged',
        data: { receipt, attempts: ctx.attempt },
      });
    },
  })
  .build();
