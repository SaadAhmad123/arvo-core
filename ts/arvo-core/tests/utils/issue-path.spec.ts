import { describe, expect, it } from 'vitest';
import { pathSegmentForKey } from '../../src/utils/issue-path.js';

describe('a map key rendered into an issue path', () => {
  it('brackets and quotes it, so a dotted key cannot be misread', () => {
    expect(`versions${pathSegmentForKey('1.0.0')}`).toBe('versions["1.0.0"]');
  });

  it('escapes a key that carries a quote of its own', () => {
    expect(pathSegmentForKey('a"b')).toBe('["a\\"b"]');
  });

  it('renders an empty key as a key rather than as nothing', () => {
    expect(pathSegmentForKey('')).toBe('[""]');
  });
});
