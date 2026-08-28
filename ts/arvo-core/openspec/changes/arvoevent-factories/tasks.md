## 1. Probes before types

- [x] 1.1 Probe that `.by`'s emit key narrows against the real classes, not a hand-written shape: `type` constrained to `keyof V['emits'] & string` rejects an undeclared key at the call site, and the payload type follows the key named. The sketch compiles, but against one contract — repeat it for a version declaring several emits and for one declaring none.
- [x] 1.2 Probe that `z.output<V['accepts']>` differs from `z.input<V['accepts']>` where the schema declares a default, so the two-sided typing in `types.ts` is load-bearing rather than decorative.
- [x] 1.3 Probe what a transform-bearing schema produces: a `z.coerce.date()` field yields a `Date` from the check, and the event's payload walk rejects it. Record what the failure looks like — a reported issue or a raised error — because §6.4 pins whichever it is.

## 2. Types and the shared pieces

- [x] 2.1 Promote `src/factories/createArvoEvent/types.ts` from the sketch: `SuppliedByContract`, `ContractEventOptions`, `ContractEventParam`, `ErrorEventParam`. Correct the stale TSDoc on `ContractEventParam` — it still says `domain` defaults to the contract's own, which stopped being true when omission came to mean no domain.
- [x] 2.2 Promote `payload.ts`. Keep `checkPayload<S extends z.$ZodObject>` returning `z.output<S>`; that return type is what carries the payload's type to the event.
- [x] 2.3 Promote `domain.ts`. Keep the `domain === undefined` guard rather than a falsiness check, so an empty string reaches the resolver and fails validation loudly. Correct its TSDoc, which also still claims omission means the contract's own.

## 3. The plain builder

- [x] 3.1 Promote `raw.ts`. Add the TSDoc it has none of: which four fields are required, that `subject` is generated when omitted and what that means, and that an unexpected throw is not converted.
- [x] 3.2 Confirm `raw` converts only `ArvoEventValidationError` and rethrows anything else, matching `createArvoContract.ts`.

## 4. The contract-aware variants

- [x] 4.1 Promote `for-contract.ts`. Delete the dead `?? undefined` tail on the `to` default — `contract.type` is a required string and can never be nullish — and move the `to` computation after the `...fields` spread, or key it off `fields.to === undefined`, so an explicitly-passed `to: undefined` cannot overwrite the default.
- [x] 4.2 Promote `by-contract.ts`. Keep the runtime guard on the schema lookup and its comment: unreachable from TypeScript, reachable from JavaScript, and without it the missing schema reaches the payload check and raises out of a `tryX`.
- [x] 4.3 Promote `handler-error.ts`. Keep the optional-chained reads off `error` and the check on the payload it composes — together they are what turn a non-`Error` into a reported failure instead of a raised `TypeError`.
- [x] 4.4 Confirm every variant reads its derived values off the contract — `contract.type`, `contract.dataschema`, `contract.handlerError.type`, `contract.handlerError.schema` — and derives none of them a second time.

## 5. Clone

- [x] 5.1 Promote `clone.ts`. Keep the single signature: overrides typed against the source event's own `T` and `D`, so a clone is always an `ArvoEvent<T, D>`.
- [x] 5.2 Document the clone's trace-context precedence in its TSDoc: a replacement span first, then replacement headers, then the cloned event's own. It holds today only because the event's constructor derives from a span after spreading everything else — invisible from this file, so a reader has no way to know it is deliberate.
- [x] 5.3 Keep the null-to-absence translation and its comment. An event stores `null` where it has no value and the input type declines `null` entirely, so a null field is dropped and normalization restores it.

## 6. Tests

- [ ] 6.1 Add `tests/factories/createArvoEvent/raw.spec.ts`: the four required fields alone, a generated subject differing between two events, a supplied subject kept, a missing required field failing, and a structural rule failing as it would through the constructor.
- [ ] 6.2 Add `tests/factories/createArvoEvent/for-contract.spec.ts`: type and dataschema from the version, the recipient defaulting to the contract's type, a supplied recipient winning, a declared default reaching the payload, a supplied value not replaced, and a rejected payload failing with positions beneath `data`.
- [ ] 6.3 Add `tests/factories/createArvoEvent/by-contract.spec.ts`: an emitted event built, the payload judged by the named type's declaration rather than a sibling's, no recipient invented, an undeclared type reported at position `type` naming what is declared, a version declaring no emits reported with its own wording, and the handler error type refused.
- [ ] 6.4 Add `tests/factories/createArvoEvent/handler-error.spec.ts`: name, message and stack composed onto the payload, an error with no stack reporting null, type and dataschema from the version, and a non-`Error` reported rather than raised.
- [ ] 6.4a Pin both transform outcomes from §1.3, in `for-contract.spec.ts`: a schema coercing to a `Date` builds an event carrying the serialized string — declared as a `Date` and not one, which is why the divergence is documented — and a schema transforming to a `Set` is reported at its position within the payload rather than raised.
- [ ] 6.5 Add `tests/factories/createArvoEvent/clone.spec.ts`: every field carried across including identity and time, a replacement applied with everything else intact, causal fields carried rather than derived, the source unchanged, and a replacement that breaks a rule failing.
- [ ] 6.5a Extend it with the trace-context precedence: a replacement span over the source's headers, both headers replaced, one header replaced with the other carried across, the source's where nothing trace-related is supplied, a span where the source had none, and none where there is nothing either side. Include the asymmetry — a span replaces both, a header replaces only itself — since a reader meeting one without the other would call it inconsistent.
- [ ] 6.6 Add `tests/factories/createArvoEvent/domain.spec.ts`: omitted giving no domain even where the contract declares one, a value used as it stands, each of the four sources, a source not supplied giving no domain, a contract declaring no domain giving none, and an empty string reaching validation rather than being swallowed.
- [ ] 6.7 Add `tests/factories/createArvoEvent/pairing.spec.ts`: for every variant, the throwing form and the primitive agree, the throwing form raises what the primitive reported, and no input a caller can supply raises out of the primitive.
- [ ] 6.8 Add `tests/factories/createArvoEvent/agreement.spec.ts` — the property that ties this change to its sibling: an event built by `.for`, `.by` and `.error` in turn, asserted back against the contract that built it, matches with the scope that variant implies.

## 7. The error's documentation

- [ ] 7.1 Amend one sentence of `ArvoEventValidationError`'s TSDoc in `src/ArvoEvent/errors.ts`. It says a payload failing contract validation "is a separate check", which the factories end: for an event built from a contract, the declaration's schema is part of what creation means. This replaces existing documentation rather than adding to it.
- [ ] 7.2 Confirm no new error type was introduced anywhere under `src/factories/`.

## 8. Public surface

- [ ] 8.1 Assemble `index.ts` into both forms: `tryCreateArvoEvent` as it stands, and `createArvoEvent` as the throwing companion, each frozen. Every property of the throwing form calls its primitive and unwraps, holding no logic of its own.
- [ ] 8.2 Export `createArvoEvent` and `tryCreateArvoEvent` from `src/index.ts`, with `ContractEventParam`, `ErrorEventParam` and `ContractEventOptions` as types. The per-variant functions stay internal — two ways to call one function is what `project.md` — *Dependencies and reuse* rejects.
- [ ] 8.3 Write the TSDoc per `project.md` for everything newly exported: rules, not provenance. State on each contract-aware variant that the payload comes back as the declaration produced it, so a caller comparing what they passed is not surprised; on `.for` that the recipient defaults to the contract's type; on `.by` and `.error` that it does not; and on `clone` that identity and time are copied, so a clone sent alongside its source needs a new one.
- [ ] 8.4 Add type-level tests for what §1 established, so the narrowing cannot regress silently.
- [ ] 8.5 Add a section to `ts/sandbox/src/playground.ts` exercising all five variants, each of the four domain sources, and the three failures a caller is likeliest to meet.

## 9. Close out

- [ ] 9.1 Run `pnpm test --coverage`, `pnpm lint` and `npx tsc --noEmit`; hold `src/factories/` at the 100% line, branch and function coverage the package holds. The `.by` guard and the non-`Error` path are reachable only from untyped callers — cover them, do not delete them.
- [ ] 9.2 Confirm nothing here derives causality. No task should have added inference of `parentid`, `initid`, `depth` or `subject` from another event, `clone` included.
- [ ] 9.3 Confirm no field is filled in with a value nothing knows. `subject` is generated, and `to` on `.for` comes from the contract; every other absent field is left absent.
- [ ] 9.4 Confirm the deferrals held: nothing resolves a version, nothing decides whether or when an event is sent, and no domain behaviour beyond reading one of the four named sources appeared.
