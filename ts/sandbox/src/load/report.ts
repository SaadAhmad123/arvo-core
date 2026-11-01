import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LoadMeasurement, LoadSkip } from './harness/results.js';

/**
 * The report of one load run: every check passed, failed or skipped, and
 * every measurement beside the same one from the newest earlier run on a
 * matching machine.
 */

/** What a run ran on, so runs are compared only with runs on the same. */
export type LoadMachine = {
  readonly cpuModel: string;
  readonly cpuCount: number;
  readonly memoryMb: number;
  readonly dockerCpus: number;
  readonly dockerMemoryMb: number;
  readonly arvoCoreBuild: string;
};

/** One check's outcome. */
type LoadCheck = {
  readonly container: string;
  readonly name: string;
  readonly status: 'passed' | 'failed' | 'skipped';
  readonly reason: string | null;
};

/** One container's outcome, as its exit and its files say. */
export type LoadContainerOutcome = {
  readonly name: string;
  readonly exitCode: number;
  readonly resultsFolder: string;
};

/** What a run comes to, as written to `report.json`. */
export type LoadReport = {
  readonly runId: string;
  readonly outbox: string;
  readonly machine: LoadMachine;
  readonly checks: readonly LoadCheck[];
  readonly measurements: readonly (LoadMeasurement & {
    readonly container: string;
    readonly previous: number | null;
  })[];
  readonly containerFailures: readonly string[];
  readonly passed: boolean;
};

/** The Vitest JSON report's shape, as far as the report reads it. */
type VitestJson = {
  readonly testResults?: readonly {
    readonly message?: string;
    readonly assertionResults?: readonly {
      readonly fullName: string;
      readonly status: string;
      readonly failureMessages?: readonly string[];
    }[];
  }[];
};

/** Every JSON line in a file, or none where it does not exist. */
const readJsonLines = <Line>(file: string): Line[] =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as Line)
    : [];

/** The checks one container ran, from Vitest's report and its own skips. */
const checksOf = (outcome: LoadContainerOutcome): LoadCheck[] => {
  const vitestFile = join(outcome.resultsFolder, 'vitest.json');
  const skips = readJsonLines<LoadSkip>(
    join(outcome.resultsFolder, 'skips.jsonl'),
  );
  if (!existsSync(vitestFile)) return [];
  const vitestJson = JSON.parse(readFileSync(vitestFile, 'utf8')) as VitestJson;
  return (vitestJson.testResults ?? []).flatMap((fileResult) => {
    const assertionResults = fileResult.assertionResults ?? [];
    if (assertionResults.length === 0 && fileResult.message) {
      // a file that failed before any check in it ran
      return [
        {
          container: outcome.name,
          name: 'loading the file',
          status: 'failed' as const,
          reason: fileResult.message,
        },
      ];
    }
    return assertionResults.map((assertion) => {
      const skip = skips.find((candidate) =>
        assertion.fullName.endsWith(candidate.check),
      );
      if (assertion.status === 'skipped' || assertion.status === 'pending') {
        return {
          container: outcome.name,
          name: assertion.fullName,
          status: 'skipped' as const,
          reason: skip?.reason ?? 'skipped without a reason',
        };
      }
      return {
        container: outcome.name,
        name: assertion.fullName,
        status: assertion.status === 'passed' ? 'passed' : 'failed',
        reason:
          assertion.status === 'passed'
            ? null
            : (assertion.failureMessages ?? []).join('\n').slice(0, 2000),
      } as const;
    });
  });
};

/** Whether two machines are the same for comparing numbers. */
const isSameMachine = (first: LoadMachine, second: LoadMachine): boolean =>
  first.cpuModel === second.cpuModel &&
  first.cpuCount === second.cpuCount &&
  first.memoryMb === second.memoryMb &&
  first.dockerCpus === second.dockerCpus &&
  first.dockerMemoryMb === second.dockerMemoryMb;

/** The newest earlier report for the same outbox on the same machine, or none. */
const previousReport = (param: {
  readonly resultsRoot: string;
  readonly runId: string;
  readonly outbox: string;
  readonly machine: LoadMachine;
}): LoadReport | null => {
  const earlierRuns = readdirSync(param.resultsRoot)
    .filter((runFolder) => runFolder < param.runId)
    .sort()
    .reverse();
  for (const runFolder of earlierRuns) {
    const reportFile = join(param.resultsRoot, runFolder, 'report.json');
    if (!existsSync(reportFile)) continue;
    const earlier = JSON.parse(readFileSync(reportFile, 'utf8')) as LoadReport;
    if (
      earlier.outbox === param.outbox &&
      isSameMachine(earlier.machine, param.machine)
    ) {
      return earlier;
    }
  }
  return null;
};

/** How a measurement compares with the last, worth a look past a fifth. */
const comparisonText = (value: number, previous: number | null): string => {
  if (previous === null || previous === 0) return '';
  const changeRatio = (value - previous) / previous;
  const changeText = `${changeRatio >= 0 ? '+' : ''}${(changeRatio * 100).toFixed(0)}%`;
  return Math.abs(changeRatio) > 0.2
    ? `${changeText} worth a look`
    : changeText;
};

/** Builds the run's report, writes `report.json` and `report.md`, and answers it. */
export const writeReport = (param: {
  readonly resultsRoot: string;
  readonly runId: string;
  readonly outbox: string;
  readonly machine: LoadMachine;
  readonly outcomes: readonly LoadContainerOutcome[];
}): LoadReport => {
  const checks = param.outcomes.flatMap(checksOf);
  const earlier = previousReport(param);
  const measurements = param.outcomes.flatMap((outcome) =>
    readJsonLines<LoadMeasurement & { container: string }>(
      join(outcome.resultsFolder, 'measurements.jsonl'),
    ).map((measurement) => ({
      ...measurement,
      previous:
        earlier?.measurements.find(
          (candidate) =>
            candidate.container === measurement.container &&
            candidate.check === measurement.check &&
            candidate.name === measurement.name,
        )?.value ?? null,
    })),
  );
  const containerFailures = param.outcomes
    .filter(
      (outcome) =>
        outcome.exitCode !== 0 &&
        !checks.some(
          (check) =>
            check.container === outcome.name && check.status === 'failed',
        ),
    )
    .map(
      (outcome) =>
        `${outcome.name} exited ${outcome.exitCode} without a failed check to show for it: it was likely stopped by its memory or process cap`,
    );
  const report: LoadReport = {
    runId: param.runId,
    outbox: param.outbox,
    machine: param.machine,
    checks,
    measurements,
    containerFailures,
    passed:
      checks.length > 0 &&
      containerFailures.length === 0 &&
      checks.every((check) => check.status !== 'failed'),
  };
  const runFolder = join(param.resultsRoot, param.runId);
  writeFileSync(
    join(runFolder, 'report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
  );
  writeFileSync(join(runFolder, 'report.md'), renderReport(report));
  return report;
};

/** The report as a person reads it. */
export const renderReport = (report: LoadReport): string => {
  const countOf = (status: LoadCheck['status']) =>
    report.checks.filter((check) => check.status === status).length;
  const lines = [
    `# Load run ${report.runId}: ${report.outbox}`,
    '',
    `**${report.passed ? 'PASSED' : 'FAILED'}**: ${countOf('passed')} passed, ${countOf('failed')} failed, ${countOf('skipped')} skipped.`,
    '',
    `Machine: ${report.machine.cpuModel}, ${report.machine.cpuCount} CPUs, ${report.machine.memoryMb} MB; Docker ${report.machine.dockerCpus} CPUs, ${report.machine.dockerMemoryMb} MB; arvo-core ${report.machine.arvoCoreBuild}.`,
    '',
  ];
  for (const containerFailure of report.containerFailures) {
    lines.push(`- **${containerFailure}**`);
  }
  const failedOrSkipped = report.checks.filter(
    (check) => check.status !== 'passed',
  );
  if (failedOrSkipped.length > 0) {
    lines.push('## Failed and skipped', '');
    for (const check of failedOrSkipped) {
      lines.push(
        `- **${check.status}** [${check.container}] ${check.name}`,
        `  ${(check.reason ?? '').split('\n').slice(0, 6).join('\n  ')}`,
      );
    }
    lines.push('');
  }
  lines.push('## Checks', '');
  for (const check of report.checks) {
    lines.push(`- ${check.status} [${check.container}] ${check.name}`);
  }
  lines.push(
    '',
    '## Measurements',
    '',
    '| Container | Check | Measurement | Value | Last run | Change |',
    '|---|---|---|---|---|---|',
  );
  for (const measurement of report.measurements) {
    lines.push(
      `| ${measurement.container} | ${measurement.check} | ${measurement.name} | ${measurement.value.toFixed(2)} ${measurement.unit} | ${measurement.previous === null ? '' : measurement.previous.toFixed(2)} | ${comparisonText(measurement.value, measurement.previous)} |`,
    );
  }
  return `${lines.join('\n')}\n`;
};
