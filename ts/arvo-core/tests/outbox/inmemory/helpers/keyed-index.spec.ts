import { describe, expect, it } from 'vitest';
import {
  addToIndex,
  type KeyedIndex,
  removeFromIndex,
} from '../../../../src/outbox/inmemory/helpers/keyed-index.js';

describe('a keyed index', () => {
  it('groups entries under their key, in the order added', () => {
    const index: KeyedIndex<string> = new Map();
    addToIndex(index, 'key-1', 'id-1', 'entry-1');
    addToIndex(index, 'key-1', 'id-2', 'entry-2');
    addToIndex(index, 'key-2', 'id-3', 'entry-3');
    expect([...(index.get('key-1')?.values() ?? [])]).toEqual([
      'entry-1',
      'entry-2',
    ]);
    expect([...(index.get('key-2')?.values() ?? [])]).toEqual(['entry-3']);
  });

  it('removes an entry, and its group once empty', () => {
    const index: KeyedIndex<string> = new Map();
    addToIndex(index, 'key-1', 'id-1', 'entry-1');
    addToIndex(index, 'key-1', 'id-2', 'entry-2');
    removeFromIndex(index, 'key-1', 'id-1');
    expect([...(index.get('key-1')?.values() ?? [])]).toEqual(['entry-2']);
    removeFromIndex(index, 'key-1', 'id-2');
    expect(index.has('key-1')).toBe(false);
  });

  it('leaves an index alone where the key holds nothing', () => {
    const index: KeyedIndex<string> = new Map();
    addToIndex(index, 'key-1', 'id-1', 'entry-1');
    removeFromIndex(index, 'key-2', 'id-1');
    expect([...index.keys()]).toEqual(['key-1']);
  });
});
