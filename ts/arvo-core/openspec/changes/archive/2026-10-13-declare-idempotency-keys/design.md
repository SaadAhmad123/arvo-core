## Context

See [proposal.md](./proposal.md) for why, and [ADR-014](../../../../docs/adr/014-idempotency-keys.md) for the composition, which is pinned and not this document's to decide. What remains is where the keys are computed and what they are called.

One constraint shapes it: this package hashes through `crypto.subtle`, which is asynchronous, and the execution context is constructed synchronously. `deriveArvoExecutionId` has the same constraint and resolves it the same way.

## Goals / Non-Goals

**Goals:**
- An executor reads a string. No awaiting, no composing, no chance to include the attempt.
- The composition lives in one function, testable against known answers, so a change to it is a change to one line and breaks a vector rather than a run.

**Non-Goals:**
- Lazy computation. ADR-014 permits it; this does not do it — see **Decisions**.
- Any sync hash, or a second hashing dependency.

## Decisions

### Computed before the context, not inside it

The version awaits all three and hands them to the context's constructor, which keeps the context synchronous as it is everywhere else. The alternative — members that are promises — would make an executor write `await ctx.idempotency.execution` for a value that is a pure function of what it already has, and would make forgetting the `await` produce a key that is the string `[object Promise]`.

### Eager rather than lazy

Three hashes per delivery whether an executor uses them or not. ADR-014 allows deferring them, and this does not, because lazy means either promise-valued members or a synchronous hash, and both cost more than the hashes do. At the widest fan-out this sandbox runs, it is three SHA-256 digests of under a hundred bytes each per delivery.

If that ever matters, the cheap fix is to compute them only where the declaration says an executor reads them — which is a reason to leave the surface as it is rather than to change it now.

### `ctx.idempotency`, an object of three

Named for what it is for rather than what it is made of, and an object rather than three members so the three sit together and a reader meets all of them at once. The scope names are `workflow`, `execution` and `delivery`, which are the words ADR-014 uses and the words the record already uses for the same three things.

### One function, and known-answer vectors

`idempotencyKeysFor` takes the subject, the execution identifier and the delivered event's id, and returns the three. The specs pin each against a literal string rather than against a reimplementation of the composition, because a spec that recomputes the thing it is checking tests nothing.

Two of those vectors exist to catch the two mistakes the composition is designed against: a workflow whose subject equals some execution's identifier, and two deliveries whose parts would form the same string if joined without a separator.

## Risks / Trade-offs

- **A pinned derivation is a pinned derivation.** Changing any part of it invalidates every key already handed to a third party, and can only be done by a superseding ADR. The prefix is where such a change has to show, so two compositions can be told apart by reading rather than by an effect made twice.
- **Three hashes per delivery, used or not.** Accepted above.
- **An opaque key is harder to trace to its execution.** The prefix names the scope; the rest needs the record. A readable key was rejected in ADR-014 for reasons that still hold.
