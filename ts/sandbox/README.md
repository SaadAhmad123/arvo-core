# sandbox (TypeScript)

A playground for trying out `arvo-core` (ts) directly off disk, without publishing it to npm first. Not part of the published package — `private: true`, never built or shipped.

`arvo-core` is linked here via `"arvo-core": "file:../arvo-core"` in `package.json` — pnpm resolves that to a live link into `../arvo-core`, not a downloaded copy.

## Setup

```bash
cd ts/arvo-core && pnpm install && pnpm run build   # arvo-core must be built at least once
cd ../sandbox && pnpm install
```

## Use

Edit `src/playground.ts`, then:

```bash
pnpm run play
```

If you change `ts/arvo-core/src/`, re-run `pnpm run build` there before the change shows up here — this sandbox imports the built `dist/` output, the same way a real consumer would, not `src/` directly.
