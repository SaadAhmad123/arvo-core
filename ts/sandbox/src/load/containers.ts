/**
 * Every container one load run starts, and the Docker settings each runs
 * under.
 *
 * Each is capped in CPU, memory, swap and processes, runs as `node` with
 * every capability dropped, has no network, and sees one host folder: its
 * own, empty results folder. `--rm` removes it when it stops.
 */

/** Which outbox a run checks. */
export type LoadOutbox = 'inmemory' | 'sqlite';

/** One container a run starts. */
export type LoadContainer = {
  /** Its name in the report and the folder its results go to. */
  readonly name: string;
  /** The test files it runs, relative to the sandbox. */
  readonly testFiles: readonly string[];
  /** The test files it leaves to another container. */
  readonly excludedFiles: readonly string[];
  /** How many CPUs it may use. */
  readonly cpus: number;
  /** How much memory it may use, in megabytes; it may not swap past it. */
  readonly memoryMb: number;
  /** Settings beyond the caps every container has. */
  readonly extraArguments: readonly string[];
  /** What it is given in its environment. */
  readonly environment: Readonly<Record<string, string>>;
};

/** The image every container is made from. */
export const LOAD_IMAGE = 'arvo-load:latest';

/** What every container a load run starts is named after, so a later run can find leftovers. */
export const LOAD_CONTAINER_PREFIX = 'arvo-load-';

/** The most processes one container may run. */
const PROCESS_CAP = 512;

/** Where libfaketime is in the image. */
const FAKETIME_LIBRARY = '/usr/local/lib/libfaketime.so.1';

/** The file the faked clock reads its time from, inside its container. */
export const FAKED_CLOCK_FILE = '/tmp/arvo-faked-clock';

/** The containers one outbox's run starts, the soak only where asked. */
export const containersFor = (param: {
  readonly outbox: LoadOutbox;
  readonly soak: boolean;
  readonly soakMinutes: number;
}): readonly LoadContainer[] => {
  const directory = `tests/load/${param.outbox}`;
  const soakFile = `${directory}/soak.load.ts`;
  const fullDiskFile = `${directory}/full-disk.load.ts`;
  const fakedClockFile = `${directory}/faked-clock.load.ts`;
  const separateFiles =
    param.outbox === 'sqlite'
      ? [soakFile, fullDiskFile, fakedClockFile]
      : [soakFile];
  const containers: LoadContainer[] = [
    {
      name: 'main',
      // the harness's own checks run once, with the in-memory suite
      testFiles:
        param.outbox === 'inmemory'
          ? ['tests/load/harness', directory]
          : [directory],
      excludedFiles: separateFiles,
      cpus: 2,
      // room for a million events held at once
      memoryMb: 3072,
      extraArguments: [],
      environment: {},
    },
  ];
  if (param.outbox === 'sqlite') {
    containers.push(
      {
        name: 'full-disk',
        testFiles: [fullDiskFile],
        excludedFiles: [],
        cpus: 1,
        memoryMb: 512,
        // a disk of its own, in its memory, never the host's
        extraArguments: [
          '--tmpfs',
          '/data:size=20m,uid=1000,gid=1000,mode=0700',
        ],
        environment: { LOAD_DISK: '/data' },
      },
      {
        name: 'faked-clock',
        testFiles: [fakedClockFile],
        excludedFiles: [],
        cpus: 1,
        memoryMb: 512,
        extraArguments: [],
        environment: {
          LD_PRELOAD: FAKETIME_LIBRARY,
          FAKETIME_TIMESTAMP_FILE: FAKED_CLOCK_FILE,
          // timers keep running at real speed; only the time of day moves
          FAKETIME_DONT_FAKE_MONOTONIC: '1',
          // read the faked time afresh on every call, so a check moves it at once
          FAKETIME_NO_CACHE: '1',
          LOAD_FAKED_CLOCK_FILE: FAKED_CLOCK_FILE,
        },
      },
    );
  }
  if (param.soak) {
    containers.push({
      name: 'soak',
      testFiles: [soakFile],
      excludedFiles: [],
      cpus: 2,
      memoryMb: 2048,
      extraArguments: [],
      environment: { LOAD_SOAK_MINUTES: String(param.soakMinutes) },
    });
  }
  return containers;
};

/** The `docker run` arguments for one container, every cap included. */
export const dockerRunArguments = (param: {
  readonly container: LoadContainer;
  readonly containerName: string;
  readonly resultsFolder: string;
}): readonly string[] => [
  'run',
  '--rm',
  '--init',
  '--name',
  param.containerName,
  `--cpus=${param.container.cpus}`,
  `--memory=${param.container.memoryMb}m`,
  `--memory-swap=${param.container.memoryMb}m`,
  `--pids-limit=${PROCESS_CAP}`,
  '--user',
  'node',
  '--cap-drop=ALL',
  '--security-opt',
  'no-new-privileges',
  '--network',
  'none',
  '--mount',
  `type=bind,source=${param.resultsFolder},target=/results`,
  ...param.container.extraArguments,
  ...Object.entries(param.container.environment).flatMap(([name, value]) => [
    '--env',
    `${name}=${value}`,
  ]),
  '--env',
  `LOAD_CONTAINER=${param.container.name}`,
  '--env',
  `LOAD_MEMORY_MB=${param.container.memoryMb}`,
  // Node's own heap limit sits well below the container's: give it most of it
  '--env',
  // and let the soak collect garbage before it samples, so a sample is what is still held
  `NODE_OPTIONS=--max-old-space-size=${Math.floor(param.container.memoryMb * 0.8)} --expose-gc`,
  LOAD_IMAGE,
  'node_modules/.bin/vitest',
  'run',
  '--config',
  'vitest.load.config.ts',
  '--reporter=verbose',
  '--reporter=json',
  '--outputFile.json=/results/vitest.json',
  ...param.container.excludedFiles.flatMap((excludedFile) => [
    '--exclude',
    excludedFile,
  ]),
  ...param.container.testFiles,
];
