## 1. The derivation

- [x] 1.1 `src/ArvoEventHandler/context/idempotency.ts`: `ArvoIdempotencyKeys`, and one function composing all three exactly as ADR-014 pins them — scope name inside the hash, `0x00` between parts, SHA-256, 64 lowercase hex, behind the readable prefix.

## 2. The specs, before the member

- [x] 2.1 Known-answer vectors: each of the three against a literal string, not against a reimplementation.
- [x] 2.2 The two collisions the composition exists to prevent: a subject equal to an execution identifier, and parts that would join into one string without a separator.
- [x] 2.3 Shape: 64 lowercase hex behind the prefix, and the scope readable in it.
- [x] 2.4 Through a handler: the workflow key is shared by two executions of one run and differs between runs; the execution key survives a later delivery and a retry; the delivery key survives a retry and differs between two events reaching one execution.
- [x] 2.5 Nothing about a key reaches the record, and the same events produce the same keys again.

## 3. The member

- [x] 3.1 `context/types.ts` and `context/index.ts`: `idempotency`, an object of three strings.
- [x] 3.2 `version/index.ts`: computed before the context is built, from the record and the delivered event.
- [x] 3.3 `src/index.ts`: the type on the public surface.

## 4. Proving it

- [x] 4.1 Whole suite green, lint and typecheck clean, coverage where it was.
- [x] 4.2 A sandbox handler uses one, so the surface is exercised by something that is not a spec — the inventory check's reservation is the obvious candidate, being the write §11.5 shows happening twice.
