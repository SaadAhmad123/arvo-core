/**
 * Where a middleware came from: passed to `execute()` for that one
 * execution, or declared on the handler in `setupArvoEventHandler()`.
 */
export type ArvoMiddlewareSource = 'supplied' | 'declared';

const LIST_AS_WRITTEN: Record<ArvoMiddlewareSource, string> = {
  supplied: 'execute({ middleware })',
  declared: 'setupArvoEventHandler({ middleware })',
};

/**
 * Names a middleware list, or one entry in it, as the code that wrote it
 * reads: `execute({ middleware })[1]`.
 *
 * Every error about an execution's middleware names its positions through
 * this, so a reader can find the entry in their own code, and a part of
 * it reads on naturally: `execute({ middleware })[1].before`.
 *
 * @param source - Which list the entry is in.
 * @param entryIndex - The entry's index in that list; omitted to name the
 * list itself.
 */
export const middlewarePosition = (
  source: ArvoMiddlewareSource,
  entryIndex?: number,
): string =>
  entryIndex === undefined
    ? LIST_AS_WRITTEN[source]
    : `${LIST_AS_WRITTEN[source]}[${entryIndex}]`;
