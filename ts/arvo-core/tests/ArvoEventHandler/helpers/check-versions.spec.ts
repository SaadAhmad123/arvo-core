import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ArvoContract } from '../../../src/ArvoContract/index.js';
import { checkVersions } from '../../../src/ArvoEventHandler/helpers/check-versions.js';
import { orderContract } from '../fixtures.js';

const twoVersions = new ArvoContract({
  type: 'com_report_build',
  versions: {
    '1.0.0': {
      input: z.object({ of: z.string() }),
      outputs: { evt_report_built: z.object({ url: z.string() }) },
    },
    '1.1.0': {
      input: z.object({ of: z.string() }),
      outputs: { evt_report_built: z.object({ url: z.string() }) },
    },
  },
});

describe('a handler implements every version of its contract', () => {
  it('accepts one version declared with an executor', () => {
    expect(checkVersions(orderContract, ['1.0.0'])).toEqual([]);
  });

  it('accepts two versions each declared with an executor', () => {
    expect(checkVersions(twoVersions, ['1.0.0', '1.1.0'])).toEqual([]);
  });

  it('accepts them in whatever order they were declared in', () => {
    expect(checkVersions(twoVersions, ['1.1.0', '1.0.0'])).toEqual([]);
  });
});

describe('a version the contract declares and the handler does not', () => {
  const issues = checkVersions(twoVersions, ['1.0.0']);

  it('is refused', () => {
    expect(issues).toHaveLength(1);
  });

  it('names the version that has no executor', () => {
    expect(issues[0]?.path).toBe('versions["1.1.0"]');
  });

  it('reports every such version, not only the first', () => {
    expect(checkVersions(twoVersions, [])).toHaveLength(2);
  });
});

describe('a version the handler declares and the contract does not', () => {
  const issues = checkVersions(orderContract, ['1.0.0', '9.9.9']);

  it('is refused', () => {
    expect(issues).toHaveLength(1);
  });

  it('names the version nothing declares', () => {
    expect(issues[0]?.path).toBe('versions["9.9.9"]');
    expect(issues[0]?.message).toContain('com_order_create');
  });
});

describe('a version declared more than once', () => {
  const issues = checkVersions(orderContract, ['1.0.0', '1.0.0']);

  it('is refused, one executor per version being the rule', () => {
    expect(issues).toHaveLength(1);
    expect(issues[0]?.path).toBe('versions["1.0.0"]');
  });

  it('is refused once however many times it was repeated', () => {
    expect(
      checkVersions(orderContract, ['1.0.0', '1.0.0', '1.0.0']),
    ).toHaveLength(1);
  });

  it('does not also report it as missing, since it was declared', () => {
    expect(
      issues.filter((issue) => issue.message.includes('no executor')),
    ).toEqual([]);
  });
});

describe('two rules broken at once', () => {
  it('reports both rather than stopping at the first', () => {
    expect(
      checkVersions(twoVersions, ['1.0.0', '1.0.0', '9.9.9']),
    ).toHaveLength(3);
  });
});
