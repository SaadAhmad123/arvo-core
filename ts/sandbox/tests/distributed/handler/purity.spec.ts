import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The handlers are the constant; the mechanisms are what vary.
 *
 * This is the one check that keeps the whole exercise honest. If a
 * handler had to know about Temporal, the comparison would no longer be
 * two mechanisms running one handler — it would be two handlers, and
 * nothing either of them proved would transfer.
 */

const HANDLERS = new URL('../../../src/distributed/handler/', import.meta.url)
  .pathname;

/** Nothing under the handlers may reach for any of these. */
const FORBIDDEN = [
  '@temporalio/',
  '@dbos-inc/',
  // nor the store, nor the pool: a handler reaches what it is given and
  // nothing else
  'pg',
  '../temporal/',
  '../dbos/',
  '../shared/',
];

/** Every TypeScript file under the handlers, at any depth. */
const filesUnder = (directory: string): string[] => {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      files.push(...filesUnder(path));
      continue;
    }
    if (path.endsWith('.ts')) files.push(path);
  }
  return files;
};

/** What one file imports, by the specifier it names. */
const importsOf = (file: string): string[] => {
  const source = readFileSync(file, 'utf8');
  const specifiers: string[] = [];
  const fromClause = /from\s+['"]([^'"]+)['"]/g;
  let match = fromClause.exec(source);
  while (match !== null) {
    if (match[1] !== undefined) specifiers.push(match[1]);
    match = fromClause.exec(source);
  }
  return specifiers;
};

describe('the handlers', () => {
  const files = filesUnder(HANDLERS);

  it('were found at all, so an empty sweep cannot pass', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((file) => [file.replace(HANDLERS, ''), file]))(
    '%s knows nothing of any mechanism',
    (_named, file) => {
      const mechanisms = importsOf(file).filter((specifier) =>
        FORBIDDEN.some(
          (forbidden) =>
            specifier === forbidden || specifier.startsWith(forbidden),
        ),
      );
      expect(mechanisms).toEqual([]);
    },
  );
});
