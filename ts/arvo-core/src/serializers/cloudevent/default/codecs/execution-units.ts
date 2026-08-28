import type { ICodec } from './interface.js';

/** `executionunits`' canonical, round-trip-checked `arvoexecutionunits` encoding. */
export class ExecutionUnitsCodec implements ICodec<number, string> {
  /**
   * The canonical number serialization this encoding requires is, for a
   * finite value, identical to the ECMAScript `ToString` algorithm
   * `JSON.stringify` already applies to a number — so this delegates to it
   * rather than reimplementing the algorithm; `decode`'s round trip is what
   * enforces canonical form on the way back in.
   */
  encode(value: number): string {
    return JSON.stringify(value);
  }

  decode(value: string): number | null {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return null;
    return JSON.stringify(parsed) === value ? parsed : null;
  }
}
