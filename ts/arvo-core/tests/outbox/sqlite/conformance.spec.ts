import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { describeArvoOutboxConformance } from '../../../src/outbox/conformance/index.js';
import { ArvoSqliteOutbox } from '../../../src/outbox/sqlite/index.js';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'arvo-sqlite-outbox-'));
const openedOutboxes: ArvoSqliteOutbox[] = [];

afterAll(() => {
  for (const openedOutbox of openedOutboxes) openedOutbox.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describeArvoOutboxConformance({
  createOutbox: () => {
    const outbox = new ArvoSqliteOutbox({
      filename: join(temporaryDirectory, `${crypto.randomUUID()}.sqlite`),
    });
    openedOutboxes.push(outbox);
    outbox.open();
    return outbox;
  },
});
