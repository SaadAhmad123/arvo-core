import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { createOwnerOnlyFile } from '../../../../src/outbox/sqlite/helpers/create-owner-only-file.js';

const temporaryDirectory = mkdtempSync(join(tmpdir(), 'arvo-owner-only-file-'));
afterAll(() => rmSync(temporaryDirectory, { recursive: true, force: true }));

describe('creating a file only its owner can use', () => {
  it('creates a missing file, readable and writable by its owner alone', () => {
    const filename = join(temporaryDirectory, 'new.sqlite');
    createOwnerOnlyFile(filename);
    expect(statSync(filename).mode & 0o777).toBe(0o600);
  });

  it('leaves a file that exists, and what it holds, as it is', () => {
    const filename = join(temporaryDirectory, 'existing.sqlite');
    writeFileSync(filename, 'held', { mode: 0o644 });
    createOwnerOnlyFile(filename);
    expect(statSync(filename).mode & 0o777).toBe(0o644);
    expect(readFileSync(filename, 'utf8')).toBe('held');
  });

  it('throws where the file cannot be created at all', () => {
    expect(() =>
      createOwnerOnlyFile(
        join(temporaryDirectory, 'missing-directory', 'outbox.sqlite'),
      ),
    ).toThrow(/ENOENT/);
  });
});
