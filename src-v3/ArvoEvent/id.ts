import pako from 'pako';
import { v4 as uuid4 } from 'uuid';
import { z } from 'zod';
import type { CreateArvoEvent } from './types';

export const ArvoEventIdObjectSchema = z.object({
  uuid: z.string(),
  value: z.string(),
});

export type ArvoEventIdObject = z.infer<typeof ArvoEventIdObjectSchema>;

export const createArvoEventId = (id?: CreateArvoEvent<Record<string, unknown>, string>['id']) => {
  if (id?.deduplication === 'ARVO_MANAGED' && id.value.trim()) {
    const data = ArvoEventIdObjectSchema.parse({ uuid: uuid4(), value: id.value.trim() });
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(new TextEncoder().encode(jsonString));
    return Buffer.from(compressed).toString('base64');
  }
  if (id?.deduplication === 'DEVELOPER_MANAGED' && id.value.trim()) {
    return id.value.trim();
  }
  return uuid4();
};

export const parseArvoEventId = (id: string) => {
  try {
    const compressed = Buffer.from(id, 'base64');
    const decompressed = pako.inflate(compressed);
    const jsonString = new TextDecoder().decode(decompressed);
    const parsed = JSON.parse(jsonString);
    return [ArvoEventIdObjectSchema.parse(parsed), null] as const;
  } catch (e) {
    return [id, e as Error] as const;
  }
};
