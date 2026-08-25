import { err, ok } from 'neverthrow';
import { ArvoContract } from '../../ArvoContract/index.js';
import { fromNeverthrow } from '../../result.js';
import type { Result } from '../../types.js';
import type { ErrorIssue } from '../../utils/error-issue.js';
import { readCanonicalForm } from './deserialize.js';
import { ArvoContractSerializerError, asError } from './errors.js';
import { buildCanonicalForm } from './serialize.js';
import type {
  ArvoContractSerializerOptions,
  ArvoContractSerializerWarnings,
  DeserializedArvoContract,
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
 * approximated. Every omission is reported alongside the result, in both
 * directions, so a contract that enforces less than it declares never comes
 * back silently. One crossing out and back keeps everything the form can
 * express; repeated crossings are not guaranteed to.
 *
 * @example Out and back
 * const serializer = new ArvoContractSerializer();
 * const { schema, warningString } = serializer.serialize(contract);
 * if (warningString) console.warn(warningString);
 *
 * const { contract: back } = serializer.deserialize(schema);
 *
 * @example Act on what a crossing cost
 * const { warnings } = serializer.serialize(contract);
 * for (const loss of warnings) console.warn(loss.path, loss.message);
 *
 * @example A form that cannot be read fails naming why
 * const result = serializer.tryDeserialize(json);
 * if (!result.ok) for (const issue of result.error.issues) console.error(issue);
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
      return fromNeverthrow(
        ok(sealed({ schema: JSON.stringify(form) }, warnings)),
      );
    } catch (error) {
      return fromNeverthrow(
        err(
          new ArvoContractSerializerError(
            'ArvoContract could not be serialized.',
            {
              cause: asError(error),
            },
          ),
        ),
      );
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

  /**
   * Builds a contract from a canonical form, reporting failure as a value.
   *
   * Never raises for an expected failure. A constraint the conversion could
   * not carry across is not a failure — it appears in `warnings` and the
   * contract is still built, weaker than the form declared.
   *
   * The reconstructed contract does not carry the literal types of the one
   * that produced the form. A canonical form contains no TypeScript, so
   * version keys and payload shapes arrive as their widened types.
   *
   * The inbound conversion rests on `zod`'s `fromJSONSchema`, which `zod`
   * documents as experimental and expects to change. A form containing a
   * construct it cannot read fails naming that construct rather than
   * producing a contract that enforces less than the form declared.
   */
  tryDeserialize(
    json: string,
  ): Result<DeserializedArvoContract, ArvoContractSerializerError> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch (error) {
      return fromNeverthrow(
        err(
          new ArvoContractSerializerError('ArvoContract could not be read.', {
            cause: asError(error),
          }),
        ),
      );
    }

    const read = readCanonicalForm(parsed);
    if (!read.ok) {
      return fromNeverthrow(
        err(
          new ArvoContractSerializerError('ArvoContract could not be read.', {
            issues: read.issues,
          }),
        ),
      );
    }

    // Not guarded. The contract's own rules have already passed, so the
    // constructor cannot reject what they accepted -- `arvo-contract` has a
    // test asserting that invariant directly. Catching here would convert a
    // broken invariant into a well-formed "could not be read", which claims a
    // kind of failure that did not occur.
    return fromNeverthrow(
      ok(
        sealed(
          { contract: new ArvoContract(read.value.param) },
          read.value.losses,
        ),
      ),
    );
  }

  /**
   * {@link tryDeserialize}, throwing instead of reporting.
   *
   * @throws {ArvoContractSerializerError} What `tryDeserialize` would report.
   */
  deserialize(json: string): DeserializedArvoContract {
    const result = this.tryDeserialize(json);
    if (result.ok) return result.value;
    throw result.error;
  }
}
