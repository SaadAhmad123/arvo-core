import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { cpus, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  containersFor,
  dockerRunArguments,
  LOAD_CONTAINER_PREFIX,
  LOAD_IMAGE,
  type LoadOutbox,
} from './containers.js';
import {
  type LoadContainerOutcome,
  type LoadMachine,
  renderReport,
  writeReport,
} from './report.js';

/**
 * `pnpm load:inmemory` and `pnpm load:sqlite`: the only part of the load
 * suite that runs on the host. It builds the image, starts each container
 * in turn, and writes the report. Every check runs inside a container;
 * nothing here touches an outbox.
 */

const SANDBOX = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const RESULTS_ROOT = join(SANDBOX, 'load-results');

/** Runs `docker` and answers what it printed, or throws what went wrong. */
const docker = (dockerArguments: readonly string[]): string => {
  const dockerRun = spawnSync('docker', dockerArguments, { encoding: 'utf8' });
  if (dockerRun.status !== 0) {
    throw new Error(
      `docker ${dockerArguments.join(' ')} failed: ${dockerRun.stderr || dockerRun.error?.message}`,
    );
  }
  return dockerRun.stdout.trim();
};

/** Every container a load run started that is still there, by name. */
const leftoverContainers = (): string[] =>
  docker([
    'ps',
    '--all',
    '--quiet',
    '--filter',
    `name=^${LOAD_CONTAINER_PREFIX}`,
  ])
    .split('\n')
    .filter((containerId) => containerId !== '');

/** Stops and removes every container a load run started. */
const removeLoadContainers = (): void => {
  const containerIds = leftoverContainers();
  if (containerIds.length > 0) docker(['rm', '--force', ...containerIds]);
};

/** What this run runs on, from the host and from Docker. */
const describeMachine = (): LoadMachine => {
  const [dockerCpus, dockerMemoryBytes] = docker([
    'info',
    '--format',
    '{{.NCPU}} {{.MemTotal}}',
  ]).split(' ');
  const arvoCorePackage = JSON.parse(
    readFileSync(join(SANDBOX, '../arvo-core/package.json'), 'utf8'),
  ) as { version: string };
  const arvoCoreCommit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: SANDBOX,
    encoding: 'utf8',
  }).stdout.trim();
  return {
    cpuModel: cpus()[0]?.model ?? 'unknown',
    cpuCount: cpus().length,
    memoryMb: Math.round(totalmem() / 1024 / 1024),
    dockerCpus: Number(dockerCpus),
    dockerMemoryMb: Math.round(Number(dockerMemoryBytes) / 1024 / 1024),
    arvoCoreBuild: `${arvoCorePackage.version} at ${arvoCoreCommit}`,
  };
};

/** Runs one container to its end, its output shown as it goes. */
const runContainer = (dockerArguments: readonly string[]): Promise<number> =>
  new Promise((settle) => {
    const containerProcess = spawn('docker', dockerArguments, {
      stdio: 'inherit',
    });
    containerProcess.once('exit', (exitCode) => settle(exitCode ?? 1));
    containerProcess.once('error', () => settle(1));
  });

/** The outbox and flags this run was asked for. */
const readArguments = () => {
  const [outboxArgument, ...flags] = process.argv.slice(2);
  if (outboxArgument !== 'inmemory' && outboxArgument !== 'sqlite') {
    throw new Error(
      `run as load:inmemory or load:sqlite, not with ${outboxArgument}`,
    );
  }
  const outbox: LoadOutbox = outboxArgument;
  const soakMinutes = Number(process.env.LOAD_SOAK_MINUTES ?? '60');
  if (!Number.isFinite(soakMinutes) || soakMinutes <= 0) {
    throw new Error(
      `LOAD_SOAK_MINUTES must be a number of minutes above zero, not ${process.env.LOAD_SOAK_MINUTES}`,
    );
  }
  return { outbox, soak: flags.includes('--soak'), soakMinutes };
};

const main = async (): Promise<number> => {
  const requested = readArguments();
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0) {
    console.error(
      'The load suite runs only inside Docker, and Docker is not running. Start Docker and run it again.',
    );
    return 2;
  }

  // a run interrupted before left its containers; none may outlive a run
  removeLoadContainers();
  const stopEverything = () => {
    removeLoadContainers();
    process.exit(130);
  };
  process.once('SIGINT', stopEverything);
  process.once('SIGTERM', stopEverything);

  console.log(`Building ${LOAD_IMAGE}, with arvo-core built fresh inside it…`);
  docker([
    'build',
    '--quiet',
    '--tag',
    LOAD_IMAGE,
    '--file',
    join(SANDBOX, 'infra/load.Dockerfile'),
    join(SANDBOX, '..'),
  ]);

  const runId = new Date().toISOString().replace(/[:.]/g, '-');
  const machine = describeMachine();
  const outcomes: LoadContainerOutcome[] = [];
  try {
    for (const container of containersFor(requested)) {
      const resultsFolder = join(RESULTS_ROOT, runId, container.name);
      mkdirSync(resultsFolder, { recursive: true });
      console.log(`\n=== ${requested.outbox}: ${container.name} ===`);
      const exitCode = await runContainer(
        dockerRunArguments({
          container,
          containerName:
            `${LOAD_CONTAINER_PREFIX}${runId}-${container.name}`.toLowerCase(),
          resultsFolder,
        }),
      );
      outcomes.push({ name: container.name, exitCode, resultsFolder });
    }
  } finally {
    removeLoadContainers();
  }

  const report = writeReport({
    resultsRoot: RESULTS_ROOT,
    runId,
    outbox: requested.outbox,
    machine,
    outcomes,
  });
  console.log(`\n${renderReport(report)}`);
  console.log(`Written to ${join(RESULTS_ROOT, runId)}`);
  return report.passed ? 0 : 1;
};

try {
  process.exitCode = await main();
} catch (error_) {
  console.error(error_ instanceof Error ? error_.message : String(error_));
  process.exitCode = 2;
}
