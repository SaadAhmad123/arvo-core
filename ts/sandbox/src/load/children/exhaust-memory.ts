/**
 * Takes memory until something stops it. Run only by the isolation check,
 * inside a capped container, to show the cap stops this process and not
 * the check that started it.
 */
const heldBlocks: Buffer[] = [];
for (;;) {
  // filled, so the memory is really taken rather than only promised
  heldBlocks.push(Buffer.alloc(64 * 1024 * 1024, 1));
}
