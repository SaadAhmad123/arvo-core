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
  encode(executionUnits: number): string {
    return JSON.stringify(executionUnits);
  }

  decode(encodedExecutionUnits: string): number | null {
    const executionUnits = Number(encodedExecutionUnits);
    if (!Number.isFinite(executionUnits)) return null;
    return JSON.stringify(executionUnits) === encodedExecutionUnits
      ? executionUnits
      : null;
  }
}
