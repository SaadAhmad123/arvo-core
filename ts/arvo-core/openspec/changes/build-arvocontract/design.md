## Context

See `proposal.md` — Why. The constraints that shape the approach:

- **Zod is the authoring surface**, already a peer dependency at `^4.0.0`. Contracts are authored in TypeScript, and `z.infer` flowing from a version's `accepts` to a handler's payload type is most of what makes the package worth using. Whatever shape the classes take, that inference must survive.
- **The package already has the parts this needs.** `ErrorIssue` and `buildErrorIssueMessage` (`src/utils/error-issue.ts`) for reporting every failure at once, `ArvoSemanticVersion.tryCheck` for version keys, and `src/ArvoEvent/validator.ts` as the established shape for a validator that normalizes then collects.
- **The canonical form is deferred but must not be foreclosed.** Nothing stored may be derived, and every optional field is materialized at its default so a future exporter is a pure projection of stored state.
- `src/proposal/ArvoContract/` is a sketch communicating intent. It is not a starting point to edit; `src-v3/ArvoContract/` predates ADR-005 entirely.

## Goals / Non-Goals

**Goals**

- Per-version `z.infer` survives to the call site, and an undeclared version key is a compile error rather than a runtime `undefined`.
- One declaration attempt surfaces every problem with the declaration.
- A version contract obtained from a container and one constructed directly are the same thing, validated identically.

**Non-Goals**

- Anything in `proposal.md` — Out of Scope, particularly the canonical form.
- Validating payloads against a contract. This change declares contracts; using one to check an event is handler-protocol work.
- Guaranteeing that two contracts declaring the same `type` are distinguishable. ADR-005 is explicit that `type` is not globally unique.

## Decisions

### Two classes, container and version

`ArvoContract` holds the authored declaration; `VersionedArvoContract` is what downstream code holds. Construction explodes the `versions` map into one version contract per key, each copying the container's `uri`, `type`, `domain`, `description`, and `metadata` alongside its own `accepts`/`emits`.

The copying looks redundant and is the point: ADR-005's **Isolation** says a version is "a complete, standalone contract," so a handler bound to one must never need a reference back to a container to know its own `uri` or build its own `dataschema`.

*Alternative considered:* one class with a version-lookup method returning a plain record. Rejected — it makes every downstream consumer carry the pair `(contract, version)` and reconstruct per-version facts, which is exactly the coupling isolation exists to remove.

### Classes now, factory later

Constructors only. `createArvoContract` and ADR-005's "authoring sugar" presets come later and will wrap these classes without changing them. Recorded here so the classes are not designed in a way a factory would have to fight — notably, all validation lives in the constructor path rather than in a builder.

### Literal version keys are preserved — verified, not assumed

`Record<ArvoSemanticVersion, …>` keys on a template literal type, which TypeScript can collapse to an index signature. If it did, `contract.versions['9.9.9']` would type-check and every version's `accepts` would widen to the same type, making the generics worthless.

Probed against the exact generic shape before adopting it. Both properties hold: indexing an undeclared key is `TS7053`, and two versions' `accepts` types remain mutually non-assignable, so `z.infer` differs per version. No `const` type parameters are needed.

*Residual sharp edge:* inference depends on the versions map reaching the constructor as an object literal (or a `const` whose type was inferred). A consumer who annotates their map as `ArvoContractVersionMapParam` collapses the keys themselves and loses both properties. Worth a doc comment; not something the type system can prevent.

### Validation: normalize, then validate, then construct

A `validator.ts` built the way `src/ArvoEvent/validator.ts` is: small `check*` functions taking `issues: ErrorIssue[]` and pushing into it, never throwing or returning early, behind one entry point returning `{ value, issues }`. The constructor throws `ArvoContractValidationError` when `issues` is non-empty.

Order matters and is fixed: defaults are applied and `uri` derived **before** any check runs, so every rule sees the values that will actually be stored. Validating raw input would let a derived `uri` reach a stored contract unchecked.

The rules split in two:

- **Contract-level** — `type` grammar, `uri` non-empty and canonical, `domain` grammar, `versions` non-empty, every version key a bare semver triple.
- **Version-level** — `emits` key grammar, object-shaped `accepts` and emits, `emits` colliding with `type` or the handler error type.

Both classes run the **same** version-level function. That is what makes the spec's *"a contract's own materialization never fails version validation"* true by construction rather than by two rule sets being kept in sync by hand. `ArvoContract` runs it across every version and collects, so a contract broken in two versions reports both; `VersionedArvoContract` runs it on itself, which matters only for direct construction and is a no-op re-check on the container path.

*Alternative considered:* the container constructs version contracts and lets their constructors throw. Rejected — the first bad version aborts the loop, so a contract with problems in `1.0.0` and `2.0.0` reports only `1.0.0`, reintroducing the fix-one-at-a-time cycle this change exists to remove.

### Issue paths address the declaration

`ErrorIssue.path` uses the shape of the authored object: `type`, `uri`, `versions.1.0.0.emits.Bad_Key`, `versions.1.0.0.accepts`. A reader should be able to go from the message to the line without a second lookup.

Version-key failures from `ArvoSemanticVersion.tryCheck` are folded in with their paths re-anchored under `versions.<key>`, reusing that grammar rather than restating it.

### Object-shaped schemas are checked structurally, not with `instanceof`

ADR-005 requires the literal `"type": "object"`. Statically, typing the position as `$ZodObject` covers TypeScript consumers. A runtime check is still needed for JavaScript consumers and for anything crossing a type assertion.

The check inspects zod's own schema definition for an object type rather than using `instanceof z.ZodObject`. Two copies of zod in a dependency tree — trivially possible with a peer dependency — make `instanceof` return false for a perfectly valid schema authored against the other copy. A structural check is immune to that.

### The handler error schema is a shared constant

ADR-005 fixes the payload as `error_name`/`error_message`/`error_stack`, invariant across versions and contracts. Only the *type string* varies, and only with `type`. So the schema is one module-level frozen value reused by every version; only `handler_{type}_error` is computed per contract.

It is exposed in the same shape as an entry of `emits` — a type and a schema — so a handler can treat everything it may emit uniformly, without a special case for the error channel. It remains absent from `emits` itself, per ADR-005.

### `dataschema` is derived, never stored

A getter returning `` `${uri}/${version}` ``. Storing it would put a derived value in the field set the future canonical exporter projects from, and create a second thing to keep consistent with `uri`.

### Errors follow the package's existing shape

One new `ArvoContractValidationError`: `_tag` discriminant, frozen `issues`, message via `buildErrorIssueMessage`. No `try*` counterpart — declaration happens at module load, where throwing is correct and a `Result` would just be unwrapped and rethrown at every call site.

### `isUriReference` moves to `utils/`

`uri` needs the same canonical RFC 3986 check `dataschema` already gets, and that logic currently sits unexported inside `src/ArvoEvent/validator.ts`. It moves to `utils/` and both call it, rather than a second copy drifting from the first — the same reasoning that moved `ErrorIssue` out of `ArvoEvent/`.

### Immutability is shallow-plus

`Object.freeze` on both instances, and additionally on `metadata`, the `versions` map, and each version's `emits` map — the containers a consumer could otherwise mutate through. Zod schema objects are left alone: freezing them risks breaking zod's own internals, and a consumer mutating a schema they authored is outside what this can defend.

## Risks / Trade-offs

**A consumer annotates their versions map, collapsing literal keys** → Type-level only, silent, and unpreventable by the types themselves. Mitigated with a doc comment on the parameter type and an example in the sandbox playground showing the inferring form.

**Two zod copies in one dependency tree** → Structural schema checks rather than `instanceof`, as above. Cannot be fully eliminated while zod types cross the public API, which is a decision already made by having zod as a peer.

**Duplicated work on the container path** → Every version is validated by the container and then re-validated by its own constructor. Contract declaration happens once at module load, so the cost is irrelevant; the alternative was two rule sets that could disagree.

**Deferring the canonical form leaves ADR-005 partly unimplemented** → Named openly in `proposal.md` rather than left for a reader to discover. The mitigations are structural: store the ADR's field set exactly, materialize defaults, keep every schema position exportable.

**Freezing `metadata` is a small behaviour surprise** → A consumer passing an object they intend to keep mutating will find it frozen. Consistent with `ArvoEvent`, which already freezes `data`.

## Migration Plan

None. New capability, additive, nothing prior depends on it. `src/proposal/` is deleted as part of the change once the real implementation lands; `src-v3/` stays as reference.

## Open Questions

None that would change the specs, the approach, or the task breakdown.
