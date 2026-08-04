import { DEPTH_GRAMMAR } from '../constants.js';
import type { ICodec } from './interface.js';

/** `depth`'s canonical unsigned-decimal `arvodepth` encoding. */
export class DepthCodec implements ICodec<number, string> {
  /** `BigInt`, not `String`, so a depth beyond `Number.MAX_SAFE_INTEGER` still encodes without switching to exponential notation. */
  encode(depth: number): string {
    return BigInt(depth).toString();
  }

  decode(value: string): number | null {
    return DEPTH_GRAMMAR.test(value) ? Number(value) : null;
  }
}
