import type { JSONObject } from '../../../types.js';
import type { ArvoRecordContracts, ArvoTouchedEvent } from '../types.js';

/**
 * What an execution's memory looks like once written out.
 *
 * Everything a record holds, with the two parts JSON cannot express turned
 * into something it can: each event in the event's own format, and what is
 * awaited as a list of pairs rather than a `Map`.
 *
 * For inspecting a stored record. Restoring one goes through the
 * serializer, which is where the events become events again.
 */
export type ArvoExecutionStateWire = {
  /** What the executor last wrote, or `null` where it wrote nothing. */
  data: JSONObject | null;

  subject: string;
  executionId: string;
  parentExecutionId: string;
  depth: number;
  source: string;
  version: string;

  lifecycle: string;
  lifecycleDescription: string | null;

  /** The event that opened the execution, in the event's own format. */
  initEvent: JSONObject;
  /** The event that caused the delivery, in the event's own format. */
  triggeringEvent: JSONObject;

  eventIds: ArvoTouchedEvent[];
  /** Pairs of an emitted event's id and its answer, or `null` for none. */
  inFlightEventMap: [string, JSONObject | null][];

  recordFormatVersion: string;
  casVersion: number;
  contracts: ArvoRecordContracts;
};
