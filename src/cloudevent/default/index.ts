import { ArvoEventValidationError } from '../../ArvoEvent/errors.js';
import { ArvoEvent } from '../../ArvoEvent/index.js';
import type { ArvoEventParam } from '../../ArvoEvent/types.js';
import { CloudEventTransformationError } from '../errors.js';
import type { IConverter } from '../interface.js';
import type { CloudEvent, ForeignCloudEventFallback } from '../types.js';
import type { Decoded } from './decode/index.js';
import {
  claimsArvoShape,
  decodeForeign,
  decodeStrict,
} from './decode/index.js';
import { encode } from './encode.js';

/** The base field-placement mapping — the always-present stage every `CloudEventConverter` wires in by default. */
export class ArvoToCloudEventConverter
  implements IConverter<ArvoEvent, CloudEvent>
{
  async convert(event: ArvoEvent): Promise<CloudEvent> {
    return encode(event);
  }

  /** Strict Arvo-shaped deserialization or foreign-event adaptation, chosen by whichever marker `data` claims — never both, never a silent fallback between them. */
  async revert(
    data: CloudEvent,
    foreignFallback?: ForeignCloudEventFallback,
  ): Promise<ArvoEvent> {
    return claimsArvoShape(data)
      ? this.assemble('strict', decodeStrict(data))
      : this.assemble('foreign', decodeForeign(data, foreignFallback));
  }

  /**
   * Assembles `decoded` through `ArvoEvent`'s own constructor — the one
   * structural-validity entry point, never reimplemented here — and
   * aggregates any mapping-level issues found before construction together
   * with whatever `ArvoEventValidationError` reports, rather than stopping
   * at the first.
   */
  private assemble(kind: 'strict' | 'foreign', decoded: Decoded): ArvoEvent {
    try {
      const event = new ArvoEvent(decoded.candidate as ArvoEventParam);
      if (decoded.issues.length > 0) {
        throw new CloudEventTransformationError({
          kind,
          issues: decoded.issues,
        });
      }
      return event;
    } catch (error) {
      if (error instanceof ArvoEventValidationError) {
        throw new CloudEventTransformationError({
          kind,
          issues: [...decoded.issues, ...error.issues],
        });
      }
      throw error;
    }
  }
}

export const defaultConverter: IConverter<ArvoEvent, CloudEvent> =
  new ArvoToCloudEventConverter();
