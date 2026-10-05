import { setupArvoEventHandler } from 'arvo-core';
import type { DistributedDependencies } from '../dependencies.js';
import { HANDLER_TELEMETRY } from '../telemetry.js';
import { auditWriteContract } from './contract.js';

/**
 * Work that answers nobody.
 *
 * Its version declares no outputs and its handler declares no services,
 * which is the one shape whose executor may legitimately return
 * nothing: there is no output it could have produced and no service it
 * could have called. It rests at `success` rather than at `idle`,
 * because nothing was left undone.
 *
 * It declares no state either, so its record carries none — and a
 * mechanism that expects every unit of work to produce a value meets
 * both of those here.
 */
export const auditWriteHandler = setupArvoEventHandler({
  contracts: { self: auditWriteContract },
  types: {} as { dependencies: DistributedDependencies },
  telemetry: HANDLER_TELEMETRY,
  options: { runTimeout: 5_000 },
})
  .handler('1.0.0', async (ctx) => {
    const requested = ctx.state.initEvent.data;
    ctx.telemetry.logger.info('audited', {
      orderRef: requested.orderRef,
      outcome: requested.outcome,
    });
  })
  .build();
