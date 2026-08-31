/**
 * A guided tour of `arvo-core` (ts) as it currently exists on disk -- not the
 * last published npm release.
 *
 * `arvo-core` is linked here via `file:../arvo-core`, so this always sees
 * whatever is currently built into `ts/arvo-core/dist/`. If you have changed
 * `ts/arvo-core/src/`, run `pnpm run build` there first before your edits show
 * up here.
 *
 *   pnpm run play              every chapter, in order
 *   pnpm run play contract     only the chapters whose title matches
 *   pnpm run play 10           only chapter 10
 *
 * The chapters live in `src/tour/`, one file each, listed in `src/tour/index.ts`.
 * Every one is standalone: copy it into your own file and change it until it
 * breaks.
 */

import { banner } from './display.js';
import { shutdownOtel } from './otel.js';
import { chapters } from './tour/index.js';

const filter = process.argv[2]?.toLowerCase();

const selected = filter
  ? chapters.filter((chapter) => chapter.title.toLowerCase().includes(filter))
  : chapters;

if (selected.length === 0) {
  console.error(`No chapter matches ${JSON.stringify(filter)}. Available:\n`);
  for (const chapter of chapters) console.error(`  ${chapter.title}`);
  process.exit(1);
}

for (const chapter of selected) {
  banner(chapter.title);
  await chapter.run();
}

await shutdownOtel();
