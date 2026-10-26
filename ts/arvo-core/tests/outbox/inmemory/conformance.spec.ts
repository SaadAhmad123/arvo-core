import { describeArvoOutboxConformance } from '../../../src/outbox/conformance/index.js';
import { ArvoMemoryOutbox } from '../../../src/outbox/inmemory/index.js';

describeArvoOutboxConformance({
  createOutbox: () => {
    const outbox = new ArvoMemoryOutbox();
    outbox.open();
    return outbox;
  },
});
