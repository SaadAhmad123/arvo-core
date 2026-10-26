/** The identifiers of event records, sorted, for comparing sets of them. */
export const sortedEventIds = (
  eventRecords: readonly { readonly id: string }[],
): string[] => eventRecords.map((eventRecord) => eventRecord.id).sort();
