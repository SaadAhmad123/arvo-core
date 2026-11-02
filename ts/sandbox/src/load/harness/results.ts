import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * What a check writes for the report: measurements and skips, one JSON
 * line each, in the container's results folder.
 */

/** Where this container's results go: `/results` inside a container. */
const resultsFolder = (): string => {
  const folder = process.env.LOAD_RESULTS ?? '/results';
  mkdirSync(folder, { recursive: true });
  return folder;
};

/** One number a check measured. */
export type LoadMeasurement = {
  readonly check: string;
  readonly name: string;
  readonly value: number;
  readonly unit: string;
};

/** One check that could not run where it is, and why. */
export type LoadSkip = {
  readonly check: string;
  readonly reason: string;
};

/** Records one number for the report. */
export const recordMeasurement = (measurement: LoadMeasurement): void => {
  appendFileSync(
    join(resultsFolder(), 'measurements.jsonl'),
    `${JSON.stringify({ container: process.env.LOAD_CONTAINER ?? 'local', ...measurement })}\n`,
  );
};

/** Records a check that could not run here, so the report names it skipped rather than passed. */
export const recordSkip = (skip: LoadSkip): void => {
  appendFileSync(
    join(resultsFolder(), 'skips.jsonl'),
    `${JSON.stringify({ container: process.env.LOAD_CONTAINER ?? 'local', ...skip })}\n`,
  );
};
