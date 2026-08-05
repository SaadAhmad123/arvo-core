/**
 * A canonical, round-trippable encoding between a decoded value and its
 * single valid string representation. `decode` returns `null` rather than
 * throwing on a non-canonical or malformed encoding — the caller decides
 * whether that's a reportable issue.
 */
export interface ICodec<T, E> {
  encode(value: T): E;
  decode(value: E): T | null;
}
