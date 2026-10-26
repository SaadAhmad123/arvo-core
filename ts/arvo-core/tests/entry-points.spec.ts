import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * What each entry point of the built package loads, followed through every
 * file it imports, so a consumer who never imports an entry point is never
 * asked for what it needs.
 */

const packageRoot = join(new URL('.', import.meta.url).pathname, '..');
const packageManifest: {
  exports: Record<string, { readonly types: string; readonly import: string }>;
} = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

/** Every specifier a built file imports or re-exports. */
const specifiersImportedBy = (builtFile: string): string[] =>
  [
    ...readFileSync(builtFile, 'utf8').matchAll(
      /(?:^|[;\s])(?:import|export)\s(?:[^'";]*?\sfrom\s*)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/gm,
    ),
  ].flatMap((importMatch) => [importMatch[1] ?? importMatch[2] ?? []].flat());

/** The packages, other than Node's own, a built entry point loads through every file it reaches. */
const packagesLoadedBy = (entryFile: string): Set<string> => {
  const packageNames = new Set<string>();
  const builtFilesVisited = new Set<string>();
  const builtFilesToVisit = [entryFile];
  for (
    let builtFile = builtFilesToVisit.pop();
    builtFile;
    builtFile = builtFilesToVisit.pop()
  ) {
    if (builtFilesVisited.has(builtFile)) continue;
    builtFilesVisited.add(builtFile);
    for (const specifier of specifiersImportedBy(builtFile)) {
      if (specifier.startsWith('.')) {
        builtFilesToVisit.push(resolve(dirname(builtFile), specifier));
      } else if (!specifier.startsWith('node:')) {
        const [scopeOrName = '', scopedName] = specifier.split('/');
        packageNames.add(
          scopeOrName.startsWith('@')
            ? `${scopeOrName}/${scopedName}`
            : scopeOrName,
        );
      }
    }
  }
  return packageNames;
};

/** The built file an entry point resolves to. */
const builtEntryFile = (entryPoint: string): string => {
  const entryExport = packageManifest.exports[entryPoint];
  if (!entryExport) throw new Error(`package.json exports no ${entryPoint}`);
  return join(packageRoot, entryExport.import);
};

describe('the built entry points', () => {
  it('each exist, with their types', () => {
    expect(Object.keys(packageManifest.exports).sort()).toEqual(
      [
        '.',
        './outbox/conformance',
        './outbox/inmemory',
        './outbox/sqlite',
      ].sort(),
    );
    for (const entryExport of Object.values(packageManifest.exports)) {
      expect(
        existsSync(join(packageRoot, entryExport.import)),
        entryExport.import,
      ).toBe(true);
      expect(
        existsSync(join(packageRoot, entryExport.types)),
        entryExport.types,
      ).toBe(true);
    }
  });

  it.each(['.', './outbox/inmemory'])(
    '%s loads neither vitest nor better-sqlite3',
    (entryPoint) => {
      const packageNames = packagesLoadedBy(builtEntryFile(entryPoint));
      expect(packageNames).not.toContain('vitest');
      expect(packageNames).not.toContain('better-sqlite3');
    },
  );

  it('./outbox/sqlite loads better-sqlite3 and not vitest', () => {
    const packageNames = packagesLoadedBy(builtEntryFile('./outbox/sqlite'));
    expect(packageNames).toContain('better-sqlite3');
    expect(packageNames).not.toContain('vitest');
  });

  it('./outbox/conformance loads vitest and not better-sqlite3', () => {
    const packageNames = packagesLoadedBy(
      builtEntryFile('./outbox/conformance'),
    );
    expect(packageNames).toContain('vitest');
    expect(packageNames).not.toContain('better-sqlite3');
  });

  it('the main entry point loads only what the package depends on or names as a peer', () => {
    const declaredPackages: { dependencies: object; peerDependencies: object } =
      JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
    const allowedPackages = [
      ...Object.keys(declaredPackages.dependencies),
      ...Object.keys(declaredPackages.peerDependencies),
    ];
    for (const packageName of packagesLoadedBy(builtEntryFile('.'))) {
      expect(allowedPackages).toContain(packageName);
    }
  });
});
