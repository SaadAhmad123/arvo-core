/**
 * Console helpers shared by the tour. Nothing here is part of `arvo-core` --
 * it only exists so each chapter can spend its lines on the API instead of
 * on formatting.
 */

/** One chapter of the tour. See `src/tour/index.ts` for the running order. */
export interface Chapter {
	/** Shown as the chapter's banner, and matched by `pnpm play <filter>`. */
	readonly title: string;
	/** Everything the chapter demonstrates. Standalone -- takes no input. */
	readonly run: () => void | Promise<void>;
}

/** A banner announcing a chapter. */
export const banner = (title: string): void =>
	console.log(`\n${"=".repeat(70)}\n${title}\n${"=".repeat(70)}`);

/** A break between two ideas inside one chapter. */
export const heading = (title: string): void => console.log(`\n--- ${title} ---\n`);

/** Indents a block -- error messages are multi-line and read better set in. */
export const indent = (text: string): string =>
	text
		.split("\n")
		.map((line) => `  ${line}`)
		.join("\n");
