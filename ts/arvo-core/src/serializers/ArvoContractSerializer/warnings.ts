import { ErrorIssue } from '../../utils/error-issue.js';

/**
 * Records a constraint that could not cross into the canonical form, or back
 * out of it.
 *
 * @param path - The position the constraint occupied.
 * @param what - What was lost, as it should read in a message.
 */
export const droppedConstraint = (path: string, what: string): ErrorIssue =>
  new ErrorIssue({ path, message: `dropped: ${what}` });

/**
 * Records a check that survived the crossing as documentation.
 *
 * Distinct from a drop on purpose. The constraint is still written in the
 * form, and a reader will see it — but no implementation is permitted to
 * enforce an annotation, so it no longer rejects anything. Read as a drop it
 * looks like data loss; read as nothing at all it looks safe. It is neither.
 *
 * @param path - The position the check occupied.
 * @param what - The check, as it should read in a message.
 */
export const demotedCheck = (path: string, what: string): ErrorIssue =>
  new ErrorIssue({
    path,
    message: `kept as documentation only, so nothing enforces it: ${what}`,
  });

/**
 * Renders every constraint lost in a crossing as one message, or `null` when
 * nothing was lost.
 *
 * Separate from `buildErrorIssueMessage` because these are not problems. A
 * constraint JSON Schema cannot carry is omitted because the model requires
 * omission rather than approximation, so a heading reading "problems were
 * found" would describe compliance as a fault.
 *
 * @param issues - Every loss, from either direction.
 */
export const buildWarningFromErrorIssues = (
  issues: readonly ErrorIssue[],
): string | null => {
  if (issues.length === 0) return null;
  const preamble =
    issues.length === 1
      ? 'One constraint did not survive the crossing:'
      : `${issues.length} constraints did not survive the crossing:`;
  const lines = issues.map((issue) => `  - ${issue.toString()}`).join('\n');
  return `${preamble}\n${lines}`;
};
