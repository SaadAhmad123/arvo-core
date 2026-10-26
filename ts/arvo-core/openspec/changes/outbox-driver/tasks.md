## 1. The two errors

- [x] 1.1 Write `tests/ArvoOutboxDriver/errors.spec.ts`: `ArvoOutboxDriverError` for each of the six kinds carries the kind, the operation and the cause, with a message naming the operation and saying what the kind means; `ArvoOutboxDriverValidationError` names every issue. Both carry their tag and name. Run red.
- [x] 1.2 Add `src/ArvoOutboxDriver/errors.ts` with library-grade TSDoc. Verify with the spec at 100% coverage.

## 2. Inbound: lifting the record and building event records

- [x] 2.1 Write `tests/ArvoOutboxDriver/helpers/lift-commit-fields.spec.ts`: the six fields lifted from a record; each missing or mistyped field reported, every one at once, including a revision that is negative, fractional or not a number. Write `tests/ArvoOutboxDriver/helpers/build-event-record.spec.ts`: every field mapped from the event, the triggering event's identifier, a revision or none, and a payload that is the event's CloudEvent JSON. Run red.
- [x] 2.2 Add `src/ArvoOutboxDriver/helpers/lift-commit-fields.ts` and `src/ArvoOutboxDriver/helpers/build-event-record.ts`. Verify with both specs at 100% coverage.

## 3. Outbound: checking answers and restoring payloads

- [ ] 3.1 Write `tests/ArvoOutboxDriver/helpers/restore-event.spec.ts` first, proving whether `ArvoEventSerializer.tryDeserialize` with no fallback refuses a payload that is not JSON and a CloudEvent that is not Arvo-shaped, and restores an Arvo event to an equal one. Write `check-state.spec.ts`, `check-commit-outcome.spec.ts` and `check-committed-records.spec.ts` beside it: each shape accepted, and each wrong shape answered as its kind. Run red.
- [ ] 3.2 Add `src/ArvoOutboxDriver/helpers/restore-event.ts`, `check-state.ts`, `check-commit-outcome.ts` and `check-committed-records.ts`, building a strict path in `restore-event.ts` only where 3.1 showed the serializer is not strict. Verify with the specs at 100% coverage.

## 4. The driver

- [ ] 4.1 Write `tests/ArvoOutboxDriver/driver.spec.ts` against `ArvoMemoryOutbox` and against stub outboxes answering wrong shapes or throwing: each operation's success; each kind each operation can report; the record and the events reaching the outbox as built, duplicates included; restoring on by default and off when asked; `leaseMs` passed through; each `X` throwing what its `tryX` answers; a record missing a field throwing the validation error with the outbox not called; the outbox called once per operation; open and close forwarded; one span per call, a child of the active span, ended on success and on failure. Write `tests/ArvoOutboxDriver/driver.types.spec.ts`: the driver is not an `IArvoOutbox`. Run red.
- [ ] 4.2 Add `src/ArvoOutboxDriver/types.ts`, `src/ArvoOutboxDriver/helpers/call-outbox.ts` and `src/ArvoOutboxDriver/index.ts`, with library-grade TSDoc and an `@example` building and using the driver, and export the driver, its param and entry types and both errors from `src/index.ts`. Verify with the whole suite at 100% coverage.

## 5. Close out

- [ ] 5.1 Run the whole suite with coverage, lint, typecheck and build from `ts/arvo-core`, and check the built main entry exports the driver.
- [ ] 5.2 Validate the change with `node_modules/.bin/openspec validate outbox-driver --strict`.

## Workflow follow-up

- Each group is shown for review and committed once approved.
- Archive the change with `/opsx:archive`, syncing `specs/outbox-driver/spec.md` into `openspec/specs/outbox-driver/`.
