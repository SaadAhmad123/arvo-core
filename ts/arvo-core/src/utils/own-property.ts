/**
 * What a map holds under a key, where it holds one itself.
 *
 * Every object inherits properties it never declared — `__proto__`,
 * `constructor`, `toString` — and reading one by index finds them. A
 * lookup keyed by a value from outside must therefore ask whether the
 * key was declared rather than whether something came back, or a crafted
 * name resolves to a value nobody ever wrote.
 *
 * @param from - The map to read.
 * @param key - The key to read, which may be anything at all.
 * @returns What it holds, or `null` where it holds nothing of its own.
 *
 * @example
 * ```typescript
 * readOwnProperty({ '1.0.0': declared }, '__proto__'); // null
 * ```
 */
export const readOwnProperty = <TValue>(
  from: Readonly<Record<string, TValue>>,
  key: string,
): TValue | null => (Object.hasOwn(from, key) ? (from[key] as TValue) : null);
