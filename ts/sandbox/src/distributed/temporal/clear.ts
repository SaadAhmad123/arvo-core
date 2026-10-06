import { readConfig } from '../shared/config.js';
import { reachTemporal } from './client.js';

/**
 * Terminates everything still running in the namespace.
 *
 * For a sandbox that has been run against several builds of the workflow
 * code. A record is a workflow here, so a record written by an earlier
 * build is still there, and querying one replays history the current code
 * was never written against — which fails as a determinism error rather
 * than as a missing record.
 *
 * Nothing a deployment would ever run. A real one versions its workflows
 * instead.
 *
 * Run with `pnpm run distributed:temporal:clear`.
 */
const main = async (): Promise<void> => {
  const config = readConfig('arvo-temporal-clear');
  const { client, close } = await reachTemporal(config);

  let terminated = 0;
  for await (const workflow of client.workflow.list({
    query: `ExecutionStatus = 'Running'`,
  })) {
    await client.workflow
      .getHandle(workflow.workflowId)
      .terminate('clearing the sandbox');
    terminated += 1;
  }

  console.log(`  terminated ${terminated} running workflow(s)`);
  await close();
};

main().catch((raised: unknown) => {
  console.error(`\n  nothing was cleared: ${String(raised)}`);
  process.exitCode = 1;
});
