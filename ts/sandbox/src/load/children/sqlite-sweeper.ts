import { createArvoSqliteOutbox } from 'arvo-core/outbox/sqlite';
import { childInput } from '../harness/processes.js';

/**
 * Lists unseen events with a lease and marks them seen, on one SQLite file,
 * until told to stop, telling its parent every event it handed out.
 */

const input = childInput<{
  readonly filename: string;
  readonly leaseMs: number;
}>();

const outbox = createArvoSqliteOutbox({
  filename: input.filename,
  busyTimeoutMs: 10_000,
});
await outbox.open();
let stopping = false;
process.on('message', (message) => {
  if ((message as { kind?: string }).kind === 'stop') stopping = true;
});
process.send?.({ kind: 'ready' });

while (!stopping) {
  const listed = outbox.listUnseenEvents({
    atMost: 100,
    olderThanMs: 0,
    leaseMs: input.leaseMs,
  });
  if (listed.length > 0) {
    const eventIds = listed.map((record) => record.id);
    outbox.markEventsSeen(eventIds);
    process.send?.({ kind: 'handed', eventIds });
  }
  await new Promise((settle) => setTimeout(settle, listed.length > 0 ? 0 : 5));
}

await outbox.close();
// a child holding its message channel open never exits; closed once the last message is sent
process.send?.({ kind: 'done' }, () => process.disconnect?.());
