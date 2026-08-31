# sandbox (TypeScript)

A playground for trying out `arvo-core` (ts) directly off disk, without publishing it to npm first. Not part of the published package — `private: true`, never built or shipped.

`arvo-core` is linked here via `"arvo-core": "file:../arvo-core"` in `package.json` — pnpm resolves that to a live link into `../arvo-core`, not a downloaded copy.

## Setup

```bash
cd ts/arvo-core && pnpm install && pnpm run build   # arvo-core must be built at least once
cd ../sandbox && pnpm install
```

## Use

```bash
pnpm run play              # every chapter, in order
pnpm run play contract     # only chapters whose title matches
pnpm run play 10           # only chapter 10
```

## The tour

`src/playground.ts` is a runner and nothing else. The material lives in `src/tour/`, one chapter per file, in the order they are worth reading:

| | |
|---|---|
| [`01-events.ts`](src/tour/01-events.ts) | building an event, what is defaulted, why `data` is frozen, what a rejected one tells you |
| [`02-throwing-vs-result.ts`](src/tour/02-throwing-vs-result.ts) | the `try`-prefixed twin every fallible operation has |
| [`03-serializing-events.ts`](src/tour/03-serializing-events.ts) | a round trip, and `cloudevent` mode versus `arvoevent` mode |
| [`04-cloudevents.ts`](src/tour/04-cloudevents.ts) | the CloudEvent boundary directly, and adapting a foreign one |
| [`05-semantic-versions.ts`](src/tour/05-semantic-versions.ts) | `ArvoSemanticVersion` as a type, a guard, and a `Result` |
| [`06-declaring-contracts.ts`](src/tour/06-declaring-contracts.ts) | what a contract holds, types per version, and broken declarations |
| [`07-contracts-as-json.ts`](src/tour/07-contracts-as-json.ts) | the canonical form, and what a crossing to JSON Schema costs |
| [`08-reading-a-foreign-form.ts`](src/tour/08-reading-a-foreign-form.ts) | JSON from elsewhere becoming a contract, and every way that fails |
| [`09-asserting-events.ts`](src/tour/09-asserting-events.ts) | judging an event against a contract, and narrowing to a typed payload |
| [`10-building-events-from-a-contract.ts`](src/tour/10-building-events-from-a-contract.ts) | the event factory: input, outputs, handler error |
| [`11-domains.ts`](src/tour/11-domains.ts) | where a domain comes from, including the `ArvoDomain` symbols |
| [`12-standalone-events-and-clones.ts`](src/tour/12-standalone-events-and-clones.ts) | an event no contract declares, and copying one |

Every chapter is standalone — it declares whatever contracts and events it needs, so you can read one on its own, or copy it into a file of your own and change it until it breaks. To add one, write it in `src/tour/` and list it in [`src/tour/index.ts`](src/tour/index.ts).

Spans go to the console via `ConsoleSpanExporter` ([`src/otel.ts`](src/otel.ts)), batched so they arrive at the end of the run rather than interrupting the chapter that made them.

If you change `ts/arvo-core/src/`, re-run `pnpm run build` there before the change shows up here — this sandbox imports the built `dist/` output, the same way a real consumer would, not `src/` directly.
