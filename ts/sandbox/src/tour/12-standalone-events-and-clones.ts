/**
 * Two ways to make an event with no contract in hand: build one from nothing,
 * or copy one that already exists and change what needs changing.
 */

import { cloneArvoEvent, createArvoEvent, tryCloneArvoEvent } from 'arvo-core';
import { type Chapter, heading } from '../display.js';
import { tracer } from '../otel.js';

/**
 * `createArvoEvent` builds an event no contract declares -- an audit record,
 * a probe, a one-off. Nothing checks the payload, because there is no schema
 * to check it against.
 */
const standalone = (): void => {
  heading('an event no contract declares');

  const event = createArvoEvent({
    type: 'com_audit_record',
    source: 'com.audit',
    dataschema: '#/com/audit/record/1.0.0',
    data: { note: 'seen' },
  });

  console.log('  type:   ', event.type);
  console.log(
    '  subject:',
    `${event.subject.slice(0, 8)}… (defaulted to a UUID)`,
  );
};

/**
 * A clone keeps everything it is not asked to change -- including the `id`,
 * so a clone is the same event routed differently, not a new one.
 */
const cloning = (): void => {
  heading('copying one');

  const original = createArvoEvent({
    type: 'com_order_created',
    source: 'com.order.service',
    dataschema: '#/com/order/create/1.0.0',
    data: { order_id: 'o-1' },
    traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    tracestate: 'vendor=original',
  });

  const routed = cloneArvoEvent(original, { to: 'com.audit.log' });
  console.log('  to:      ', routed.to);
  console.log('  same id: ', routed.id === original.id);
  console.log('  data kept:', JSON.stringify(routed.data));
};

/**
 * Trace context has a precedence, because there are two ways to supply it and
 * they can disagree. A replacement `span` wins; then a replacement header;
 * then the original event's own.
 *
 * A `span` replaces both headers, so a span carrying no trace state leaves the
 * clone with none -- it does not fall back to the original's `tracestate`.
 */
const traceContextPrecedence = (): void => {
  heading('which trace context a clone ends up with');

  const original = createArvoEvent({
    type: 'com_order_created',
    source: 'com.order.service',
    dataschema: '#/com/order/create/1.0.0',
    data: {},
    traceparent: '00-11111111111111111111111111111111-2222222222222222-01',
    tracestate: 'vendor=original',
  });

  const span = tracer.startSpan('audit.forward');

  const show = (
    label: string,
    event: { traceparent: string | null; tracestate: string | null },
  ) =>
    console.log(
      `  ${label.padEnd(28)} traceparent ${event.traceparent?.slice(0, 20)}…  tracestate ${event.tracestate ?? '(none)'}`,
    );

  show('nothing overridden', cloneArvoEvent(original));
  show(
    'a header overridden',
    cloneArvoEvent(original, { tracestate: 'vendor=replaced' }),
  );
  show('a span overridden', cloneArvoEvent(original, { span }));
  span.end();
};

/**
 * The `try` twin, for a clone whose overrides might not be valid.
 *
 * Note the second issue. Changing `subject` alone leaves `executionid` set to
 * the *original* subject, which breaks the rule that a root event's execution
 * is the workflow itself -- so renaming the subject of a root event means
 * supplying `executionid` too.
 */
const whenACloneIsRejected = (): void => {
  heading('when a clone is rejected');

  const original = createArvoEvent({
    type: 'com_order_created',
    source: 'com.order.service',
    dataschema: '#/com/order/create/1.0.0',
    data: {},
  });

  const attempt = tryCloneArvoEvent(original, { subject: '' });
  if (!attempt.ok) {
    for (const issue of attempt.error.issues) {
      console.log(`  ${issue.path}: ${issue.message}`);
    }
  }
};

export const chapter: Chapter = {
  title: '12. Standalone events and clones',
  run: () => {
    standalone();
    cloning();
    traceContextPrecedence();
    whenACloneIsRejected();
  },
};
