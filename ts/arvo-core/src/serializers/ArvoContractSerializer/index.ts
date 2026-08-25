import type { ArvoContract } from '../../ArvoContract/index.js';
import type { Result } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';
import { ArvoContractSerializerError } from './errors.js';
import { buildCanonicalForm } from './serialize.js';
import type {
  ArvoContractSerializerOptions,
  ArvoContractSerializerWarnings,
  SerializedArvoContract,
} from './types.js';
import { buildWarningFromErrorIssues } from './warnings.js';

/** Freezes a result and the losses inside it, so it is immutable throughout. */
const sealed = <T extends object>(
  value: T,
  warnings: ErrorIssue[],
): T & ArvoContractSerializerWarnings =>
  Object.freeze({
    ...value,
    warnings: Object.freeze([...warnings]),
    warningString: buildWarningFromErrorIssues(warnings),
  });

/**
 * Converts a contract to its canonical JSON form.
 *
 * A contract's portable identity is that form, not the TypeScript that
 * declared it — which is what lets a contract written here be read by an
 * implementation in another language.
 *
 * A crossing can cost something. JSON Schema cannot express every constraint
 * zod can, and where it cannot the constraint is omitted rather than
 * approximated. Every omission is reported alongside the result, so a form
 * that enforces less than the contract did never comes back silently.
 *
 * @example Serialize a contract
 * const serializer = new ArvoContractSerializer();
 * const { schema, warningString } = serializer.serialize(contract);
 * if (warningString) console.warn(warningString);
 *
 * @example Report what a crossing cost
 * const { warnings } = serializer.serialize(contract);
 * for (const loss of warnings) console.warn(loss.path, loss.message);
 */
export class ArvoContractSerializer {
  private readonly options: ArvoContractSerializerOptions;

  /**
   * @param options - Conversion settings, keyed by direction. The dialect is
   * not among them: the canonical form is JSON Schema 2020-12, and a form in
   * another dialect is not a canonical form.
   */
  constructor(options: ArvoContractSerializerOptions = {}) {
    this.options = options;
  }

  /**
   * Builds a contract's canonical form, reporting failure as a value.
   *
   * Never raises for an expected failure. A constraint that could not be
   * expressed is not a failure — it appears in `warnings` and the form is
   * still produced.
   */
  trySerialize(
    contract: ArvoContract,
  ): Result<SerializedArvoContract, ArvoContractSerializerError> {
    try {
      const { form, warnings } = buildCanonicalForm(
        contract,
        this.options.serialize,
      );
      return {
        ok: true,
        value: sealed({ schema: JSON.stringify(form) }, warnings),
      };
    } catch (error) {
      return {
        ok: false,
        error: new ArvoContractSerializerError(
          'ArvoContract could not be serialized.',
          { cause: error instanceof Error ? error : new Error(String(error)) },
        ),
      };
    }
  }

  /**
   * {@link trySerialize}, throwing instead of reporting.
   *
   * @throws {ArvoContractSerializerError} What `trySerialize` would report.
   */
  serialize(contract: ArvoContract): SerializedArvoContract {
    const result = this.trySerialize(contract);
    if (result.ok) return result.value;
    throw result.error;
  }
}
