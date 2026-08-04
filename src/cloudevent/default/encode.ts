import type { ArvoEvent } from '../../ArvoEvent/index.js';
import { CloudEvent } from '../types.js';
import { DepthCodec } from './codecs/depth.js';
import { ExecutionUnitsCodec } from './codecs/execution-units.js';
import { DATA_CONTENT_TYPE, DATA_SCHEMA, SPEC_VERSION } from './constants.js';

/**
 * Every field placed onto the CloudEvent unconditionally, plus every
 * nullable one omitted rather than encoded when its ArvoEvent value is
 * `null`. Conformance to CloudEvents itself is delegated to the
 * `cloudevents` package's own constructor below, not reimplemented here.
 */
export const encode = async (event: ArvoEvent): Promise<CloudEvent> => {
  const depthCodec = new DepthCodec();
  const executionUnitsCodec = new ExecutionUnitsCodec();

  const extensions: Record<string, unknown> = {};
  if (event.traceparent !== null) extensions.traceparent = event.traceparent;
  if (event.tracestate !== null) extensions.tracestate = event.tracestate;
  if (event.parentid !== null) extensions.arvoparentid = event.parentid;
  if (event.initid !== null) extensions.arvoinitid = event.initid;
  extensions.arvoexecutionid = event.executionid;
  if (event.category !== null) extensions.arvocategory = event.category;
  extensions.arvodepth = depthCodec.encode(event.depth);
  if (event.to !== null) extensions.arvoto = event.to;
  if (event.domain !== null) extensions.arvodomain = event.domain;
  if (event.executionunits !== null) {
    extensions.arvoexecutionunits = executionUnitsCodec.encode(
      event.executionunits,
    );
  }

  return new CloudEvent({
    id: event.id,
    source: event.source,
    type: event.type,
    subject: event.subject,
    time: event.time,
    specversion: SPEC_VERSION,
    datacontenttype: DATA_CONTENT_TYPE,
    dataschema: DATA_SCHEMA,
    data: {
      arvoeventdata: event.data,
      arvoeventdataschema: event.dataschema,
      arvoeventbaggage: event.baggage,
    },
    ...extensions,
  });
};
