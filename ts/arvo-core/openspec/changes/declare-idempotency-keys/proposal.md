## Why

An executor's code can run twice. Two deliveries of one event can be carried out at the same moment, both finding no record, both entering the executor, and both writing to whatever is outside Arvo; one commits and the other is refused. The record is right — one execution, one answer — and the world outside has been written to twice. [`serialized-writes.spec.ts`](../../../../ts/sandbox/tests/distributed/temporal/serialized-writes.spec.ts) demonstrates it against real Postgres: the stock drops twice while one record exists.

Everything an executor needs to defend against that is already on the context, which is the problem. Assembling a key means knowing that the execution identifier is stable across retries, that an event's `id` is stable across redeliveries, and that **the attempt number is not stable at all** — and the attempt is the one an author reaches for, because a retry is what they are thinking about. A key containing it is a different key on every attempt, which is the double write again with more code. The mistake does not fail: it works until a retry overlaps its original.

This change implements [ADR-014: Idempotency Keys](../../../../docs/adr/014-idempotency-keys.md).

## What Changes

- The execution context gains an `idempotency` member holding three keys: `workflow`, `execution` and `delivery`.
- Each is composed exactly as ADR-014 pins it — the scope name inside the hash, `0x00` between the parts, SHA-256, 64 lowercase hex, behind a readable prefix.
- There is deliberately **no** key scoped on the attempt, and no way to ask for one.
- All three are derived from the record and the delivered event, so nothing is stored, no field is added, and a replay of the same events produces the same keys.

## Capabilities

### New Capabilities
- `execution-idempotency-keys`: the keys an executor hands to something outside Arvo that accepts one, and what each is the same for.

### Modified Capabilities

None. The execution context belongs to the `event-handler` capability, which is still in flight under `declare-arvoeventhandler` and not yet a standing spec, so there is no requirement here to delta.

## Impact

- `src/ArvoEventHandler/context/idempotency.ts` — new: the type and the pinned derivation.
- `src/ArvoEventHandler/context/types.ts`, `context/index.ts` — the member.
- `src/ArvoEventHandler/version/index.ts` — computes the three before building the context.
- `src/index.ts` — the type on the public surface.
- No mechanism changes. The keys are the handler's to compose from what it already holds.

## Deliberately out of scope

- **Making anything idempotent.** A key is a string to hand to something else, and whether that thing honours it is its own business.
- **Narrowing the two-executors warning.** This is how an executor makes that safe, not a reason it stops happening.
- **A per-application namespace or salt.** An application wanting one prefixes the key it passes on.
