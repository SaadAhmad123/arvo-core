import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyToJSON } from '@temporalio/common/lib/proto-utils.js';
import { createArvoEventFactory } from 'arvo-core';
import { orderFulfilContract } from '../handler/com_order_fulfil/contract.js';
import { readConfig } from '../shared/config.js';
import { reachTemporal, startRun } from './client.js';

/**
 * Captures one run's history and writes it where the determinism check
 * reads it.
 *
 * The recorded history is what makes that check able to fail. A replay
 * of a history the current code just wrote only proves the code agrees
 * with itself; a replay of one committed alongside an earlier version of
 * the code proves a change has not broken executions already in flight.
 *
 * So the recorded history is a fixture with a rule attached: it is
 * replaced only deliberately, and replacing it to make a failing check
 * pass is the one thing it exists to prevent.
 *
 * Needs the stack up and a worker running.
 *
 * Run directly: `pnpm run distributed:temporal:record-history`.
 */

/** Where the fixture lives, which the spec reads from the same path. */
const RECORDED = fileURLToPath(
  new URL(
    '../../../tests/fixtures/temporal/arvo-run-history.json',
    import.meta.url,
  ),
);

/** What this run answers to. Not a handler's type, as a sender must ensure. */
const CALLER = 'com.recorder.checkout';

/**
 * Narrow and shallow, deliberately.
 *
 * Every branch of the loop is exercised by this — a fan-out, a walk, a
 * retry, an abandonment and a request that leaves the lattice — and a
 * history that did it five hundred times would be a fixture nobody can
 * read and a check nobody can diff.
 */
const WIDTH = 2;
const DEPTH = 1;

const main = async (): Promise<void> => {
  const config = readConfig('arvo-record-history');
  const { client, close } = await reachTemporal(config);

  try {
    const orderRef = `ORD-RECORDED-${Date.now()}`;
    const opening = createArvoEventFactory(
      orderFulfilContract.versions['1.0.0'],
    ).createInput({
      source: CALLER,
      subject: orderRef,
      to: orderFulfilContract.type,
      data: { orderRef, category: 'orders', width: WIDTH, depth: DEPTH },
    });

    const outcome = await startRun(client, opening);
    const history = await client.workflow
      .getHandle(`run-${opening.id}`)
      .fetchHistory();

    await mkdir(dirname(RECORDED), { recursive: true });
    // Temporal's own encoding rather than `JSON.stringify`, which turns
    // a protobuf timestamp into a pair of numbers nothing reads back.
    // This is the format every other Temporal tool writes, so the
    // fixture is one `tctl` or the UI could also have produced.
    await writeFile(RECORDED, `${historyToJSON(history)}\n`);

    console.log(`\n  recorded  ${RECORDED}`);
    console.log(`  run       run-${opening.id}`);
    console.log(`  came to   ${outcome.kind}`);
    console.log(`  events    ${history.events?.length ?? 0}\n`);
  } finally {
    await close();
  }
};

/** Whether this file is what Node was asked to run, rather than imported. */
const runDirectly =
  process.argv[1] !== undefined &&
  fileURLToPath(import.meta.url) === process.argv[1];

if (runDirectly) {
  main().catch((raised: unknown) => {
    console.error(raised);
    process.exitCode = 1;
  });
}
