/** Entries grouped under a key, each group keyed by identifier in the order added. */
export type KeyedIndex<Indexed> = Map<string, Map<string, Indexed>>;

/** Adds an entry under `key`, starting its group where none is. */
export const addToIndex = <Indexed>(
  index: KeyedIndex<Indexed>,
  key: string,
  id: string,
  indexed: Indexed,
): void => {
  const group = index.get(key);
  if (group) group.set(id, indexed);
  else index.set(key, new Map([[id, indexed]]));
};

/** Removes an entry from under `key`, and the group with it once empty. */
export const removeFromIndex = <Indexed>(
  index: KeyedIndex<Indexed>,
  key: string,
  id: string,
): void => {
  const group = index.get(key);
  group?.delete(id);
  if (group?.size === 0) index.delete(key);
};
