import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { checkAgainstSchema } from '../../src/utils/check-against-schema.js';

/** A shape with a nested object and a list, to address issues inside. */
const buildSchema = () =>
  z.object({
    name: z.string(),
    parts: z.array(z.object({ size: z.number() })),
  });

describe('checking an answer against a schema', () => {
  it('answers what the schema produced, unknown keys dropped', () => {
    expect(
      checkAgainstSchema(
        buildSchema(),
        { name: 'outbox', parts: [{ size: 1 }], extra: true },
        'answer',
      ),
    ).toEqual({ ok: true, value: { name: 'outbox', parts: [{ size: 1 }] } });
  });

  it('names each issue under the root, a position in brackets and a key after a dot', () => {
    const checkResult = checkAgainstSchema(
      buildSchema(),
      { name: 3, parts: [{ size: 1 }, { size: 'big' }] },
      'answer',
    );
    expect(
      !checkResult.ok &&
        checkResult.error.map((issue) => [issue.path, issue.received]),
    ).toEqual([
      ['answer.name', 3],
      ['answer.parts[1].size', 'big'],
    ]);
  });

  it('names an issue with the whole answer by the root alone', () => {
    const checkResult = checkAgainstSchema(buildSchema(), 'outbox', 'answer');
    expect(
      !checkResult.ok &&
        checkResult.error.map((issue) => [issue.path, issue.received]),
    ).toEqual([['answer', 'outbox']]);
  });

  it('receives nothing where the issue is beneath a value that is not there', () => {
    const checkResult = checkAgainstSchema(
      z.object({ inner: z.object({ size: z.number() }) }),
      { inner: {} },
      'answer',
    );
    expect(
      !checkResult.ok &&
        checkResult.error.map((issue) => [issue.path, issue.received]),
    ).toEqual([['answer.inner.size', undefined]]);
  });
});
