Every group starts with its tests, ends at 100% coverage with lint and typecheck clean, and is its own commit. Every change under `src/` is shown for review before its commit.

## 1. The span-or-context helper, shared

- [x] 1.1 Extend `tests/ArvoEvent/opentelemetry.spec.ts`: the helper returns a span's context for a span, and the context itself for a context.
- [x] 1.2 In `src/ArvoEvent/opentelemetry.ts`, export the existing private span-or-context test as a helper returning the `SpanContext`, and have `traceContextFromSpan` use it. Every existing test passes unedited.

## 2. Mutating an event

- [x] 2.1 Write `tests/factories/mutateArvoEvent.spec.ts` covering each scenario under *Mutating An Event*: nothing replaced; one field replaced; several replaced at once; every replaceable field replaced in turn; `type` and `data` replaced and carried; fields held as `null` staying `null`; a replacement given as `undefined` replacing nothing, `time` and `id` among them; causal fields carried; the source untouched; a replacement breaking a rule. And under *The Trace Context Of A Mutation*: for each case in the clone's trace-context requirement — a span, a span with no trace state, both headers, one header, neither, a span with an all-zero context — the mutation and the clone agree, and a span-only mutation keeps every other field.
- [x] 2.2 Write the pairing cases into `tests/factories/pairing.spec.ts` and `tests/factories/agreement.spec.ts` for the new pair: the primitive does not throw, the companion throws what the primitive reported, both agree.
- [x] 2.3 Write `tests/factories/mutateArvoEvent.types.spec.ts`: the result keeps `T` and `D` when neither `type` nor `data` is given; takes the replacement `type` as a literal; takes the replacement `data`'s type; a mutation is typed in the shape an event is built from, `span` included. (A span beside a header is resolved by precedence, not refused by the compiler: `createArvoEvent`'s input does not refuse it either, and the mutation takes that input's shape.)
- [x] 2.4 Add `ArvoEventMutation`, `tryMutateArvoEvent` and `mutateArvoEvent` in `src/factories/mutateArvoEvent.ts`, built through `ArvoEvent.tryParse`, with no cast. TSDoc follows `project.md`: rules, not reasons; an example on each function that calls that function. Each of the three opens by saying it is for code built on `arvo-core` that carries events between producer and consumer — runtimes, mechanisms, frameworks, tooling — and that an event an executor or application emits is built from its contract instead.

## 3. Cloning over the mutation

- [ ] 3.1 Add to `tests/factories/cloneArvoEvent.spec.ts` the one new case: a span whose context carries no valid trace leaves the clone with its source's trace context. Every other clone test stays as it is.
- [ ] 3.2 **Replace** the body of `tryCloneArvoEvent` in `src/factories/cloneArvoEvent.ts` with one call to `tryMutateArvoEvent`, keeping its signature and its TSDoc. **Delete** its private trace-resolution helper and its cast. Every existing clone, pairing and agreement test passes unedited.

## 4. The public surface

- [ ] 4.1 Export `ArvoEventMutation`, `tryMutateArvoEvent` and `mutateArvoEvent` from `src/index.ts`, with a test that each is reachable from the package entry.

## 5. Proof

- [ ] 5.1 Full suite with coverage at 100% bar the guards already uncovered, lint and typecheck clean, `pnpm build` clean.
