import { describe, expect, it } from 'vitest';
import {
  checkVersions,
  checkVersionsDeclaredOnce,
} from '../../../src/ArvoEventHandler/helpers/check-versions.js';
import type { ArvoSemanticVersion } from '../../../src/semver/index.js';
import { orderContract } from './fixtures.js';

const check = (declared: string[]) =>
  checkVersions(orderContract, declared as ArvoSemanticVersion[]);

describe('checkVersions', () => {
  it('accepts every declared version being covered', () => {
    expect(check(['1.0.0', '1.1.0'])).toEqual([]);
  });

  it('accepts them in any order, a chain having no required one', () => {
    expect(check(['1.1.0', '1.0.0'])).toEqual([]);
  });

  it('reports a version with no handler, by name', () => {
    const issues = check(['1.0.0']);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('versions["1.1.0"]');
  });

  it('reports every version with no handler, not just the first', () => {
    expect(check([])).toHaveLength(2);
  });

  it('reports a handler for a version the contract does not declare', () => {
    const issues = check(['1.0.0', '1.1.0', '9.9.9']);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.received).toBe('9.9.9');
  });

  it('names the versions that do exist, so the mistake is correctable', () => {
    const unknown = check(['1.0.0', '1.1.0', '9.9.9'])[0];
    expect(unknown?.message).toContain('1.0.0, 1.1.0');
  });

  it('reports both directions at once', () => {
    const issues = check(['1.0.0', '9.9.9']);
    expect(issues.map((issue) => issue.path)).toEqual([
      'versions["1.1.0"]',
      'versions["9.9.9"]',
    ]);
  });

  it('reports nothing as blocking', () => {
    expect(check([]).every((issue) => !issue.isBlocking)).toBe(true);
  });
});

describe('checkVersionsDeclaredOnce', () => {
  const once = (declared: string[]) =>
    checkVersionsDeclaredOnce(declared as ArvoSemanticVersion[]);

  it('accepts each version declared once', () => {
    expect(once(['1.0.0', '1.1.0'])).toEqual([]);
  });

  it('accepts nothing declared at all', () => {
    expect(once([])).toEqual([]);
  });

  it('reports a version declared twice', () => {
    const issues = once(['1.0.0', '1.0.0']);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('versions["1.0.0"]');
  });

  it('reports a version declared three times only once', () => {
    expect(once(['1.0.0', '1.0.0', '1.0.0'])).toHaveLength(1);
  });

  it('reports each repeated version separately', () => {
    expect(once(['1.0.0', '1.1.0', '1.0.0', '1.1.0'])).toHaveLength(2);
  });
});
