import { z } from 'zod';

const KNOWN_EVENT_KEYS = [
  'id',
  'parentid',
  'to',
  'time',
  'executionunits',
  'domain',
  'traceparent',
  'tracestate',
  'baggage',
  'rootsubject',
  'depth',
  'source',
  'subject',
  'dataschema',
  'type',
  'data',
] as const;

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const ArvoEventValidationSchema = z
  .object({
    id: z.string().min(1),
    parentid: z.string().min(1).nullable(),
    to: z.string().min(1).nullable(),
    time: z.iso.datetime({ offset: true }),
    executionunits: z.number().nonnegative().nullable(),
    domain: z.string().nullable(),
    traceparent: z.string().nullable(),
    tracestate: z.string().min(1).nullable(),
    baggage: z.record(z.string(), scalarSchema),
    rootsubject: z.string().min(1).nullable(),
    depth: z.number().int().nonnegative(),
    source: z.string().min(1),
    subject: z.string().min(1),
    dataschema: z.string().min(1).nullable(),
    type: z.string().min(1),
    extensions: z
      .record(z.string(), scalarSchema)
      .refine(
        (ext) =>
          Object.keys(ext).every(
            (key) => !(KNOWN_EVENT_KEYS as readonly string[]).includes(key),
          ),
        {
          message:
            'extensions must not use a key that collides with a known ArvoEvent field',
        },
      ),
  })
  .refine(
    (event) => (event.depth === 0) === (event.rootsubject === event.subject),
    {
      message:
        'depth must be 0 if and only if this event is a root event (rootsubject === subject)',
    },
  );
