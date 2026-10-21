import { describeValue } from './error-issue.js';

/**
 * What was thrown, as text, for a message or a span: an Error's message,
 * anything else as `String()` renders it.
 *
 * Never throws itself. A thrown value can be anything code chose to
 * throw, including one `String()` cannot render, such as a null-prototype
 * object, or an Error whose message cannot be read; those fall back to a
 * description of the value, and failing that to a fixed phrase.
 *
 * @param thrown - Whatever was caught.
 */
export const textOfThrown = (thrown: unknown): string => {
  try {
    return thrown instanceof Error ? thrown.message : String(thrown);
  } catch {
    try {
      return describeValue(thrown);
    } catch {
      return 'a thrown value that could not be turned into text';
    }
  }
};
