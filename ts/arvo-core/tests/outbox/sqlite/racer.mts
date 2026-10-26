import { parentPort, workerData } from 'node:worker_threads';
import { ArvoSqliteOutbox } from '../../../dist/outbox/sqlite/index.js';

/**
 * One of several threads committing the first revision of the same
 * executions to one file, all starting together. It answers with which
 * of its commits landed.
 */

const { filename, executionIds, startingLine } = workerData as {
  filename: string;
  executionIds: string[];
  startingLine: SharedArrayBuffer;
};

const threadsAtStartingLine = new Int32Array(startingLine);
Atomics.add(threadsAtStartingLine, 0, 1);
while (Atomics.load(threadsAtStartingLine, 0) < 2) {
  Atomics.wait(threadsAtStartingLine, 0, 1, 5);
}

const outbox = new ArvoSqliteOutbox({ filename });
outbox.open();
const committedByExecution = executionIds.map(
  (executionId) =>
    outbox.commitStateAndEvents({
      executionId,
      casVersion: 0,
      subject: executionId,
      source: 'com_racer_source',
      version: '1.0.0',
      lifecycle: 'waiting',
      state: { racer: workerData.racerName },
      events: [],
    }).committed,
);
outbox.close();
parentPort?.postMessage(committedByExecution);
