import { createArvoSqliteOutbox } from 'arvo-core/outbox/sqlite';
import { buildRecord, buildState } from '../harness/builders.js';
import { childInput } from '../harness/processes.js';

/**
 * Commits the first revision of each execution it is given, with events,
 * to one SQLite file, telling its parent which landed. Several run at once
 * against one file in the processes check; one is killed mid-commit in the
 * failures check.
 */

const input = childInput<{
  readonly filename: string;
  readonly executionIds: readonly string[];
  readonly eventsPerCommit: number;
  readonly busyTimeoutMs?: number;
}>();

const outbox = createArvoSqliteOutbox({
  filename: input.filename,
  busyTimeoutMs: input.busyTimeoutMs ?? 10_000,
});
await outbox.open();
process.send?.({ kind: 'ready' });

for (const executionId of input.executionIds) {
  process.send?.({ kind: 'committing', executionId });
  const outcome = outbox.commitStateAndEvents({
    executionId,
    casVersion: 0,
    subject: executionId,
    source: 'com_load_source',
    version: '1.0.0',
    lifecycle: 'waiting',
    state: buildState({ executionId, casVersion: 0 }),
    events: Array.from({ length: input.eventsPerCommit }, () =>
      buildRecord({
        executionId,
        triggeringEventId: executionId,
        casVersion: 0,
      }),
    ),
  });
  process.send?.({ kind: 'committed', executionId, landed: outcome.committed });
}

await outbox.close();
// a child holding its message channel open never exits; closed once the last message is sent
process.send?.({ kind: 'done' }, () => process.disconnect?.());
