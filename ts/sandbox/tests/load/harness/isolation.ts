import { fork } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Checks, from inside its own container, that a load container is the box
 * the suite promises: capped, unprivileged, networkless, and seeing no host
 * folder but its results. Run first in every outbox's suite.
 */

/** One cgroup setting of this container, as the kernel holds it. */
const cgroupSetting = (setting: string): string =>
  readFileSync(`/sys/fs/cgroup/${setting}`, 'utf8').trim();

/** One line of this process's status, by its name. */
const processStatus = (field: string): string =>
  (
    readFileSync('/proc/self/status', 'utf8')
      .split('\n')
      .find((line) => line.startsWith(`${field}:`)) ?? ''
  )
    .split(':')[1]
    ?.trim() ?? '';

export const describeContainerIsolation = (): void => {
  describe('the container this suite runs in', () => {
    it('runs as a user other than root', () => {
      expect(process.getuid?.()).not.toBe(0);
    });

    it('has no network but its own loopback', () => {
      expect(Object.keys(networkInterfaces())).toEqual(['lo']);
    });

    it('is capped in memory, with no swap past it, and in processes', () => {
      const memoryMb = Number(process.env.LOAD_MEMORY_MB);
      expect(Number(cgroupSetting('memory.max'))).toBe(memoryMb * 1024 * 1024);
      expect(cgroupSetting('memory.swap.max')).toBe('0');
      expect(cgroupSetting('pids.max')).toBe('512');
    });

    it('holds no capability, and can gain none', () => {
      expect(processStatus('CapEff')).toBe('0000000000000000');
      expect(processStatus('NoNewPrivs')).toBe('1');
    });

    it('sees no host folder but its own results folder', () => {
      const hostMountTargets = readFileSync('/proc/self/mountinfo', 'utf8')
        .split('\n')
        .filter((mountLine) =>
          /\s-\s(fakeowner|virtiofs|grpcfuse|fuse\.\S+|9p)\s/.test(mountLine),
        )
        .map((mountLine) => mountLine.split(' ')[4]);
      expect(hostMountTargets).toEqual(['/results']);
    });

    it('stops only the process that uses up its memory, leaving this one running', async () => {
      const childScript = fileURLToPath(
        new URL(
          '../../../src/load/children/exhaust-memory.ts',
          import.meta.url,
        ),
      );
      expect(existsSync(childScript)).toBe(true);
      const exhaustingChild = fork(childScript, [], {
        execArgv: ['--import', 'tsx', '--max-old-space-size=8192'],
        stdio: 'ignore',
      });
      const childEnding = await new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((settle) =>
        exhaustingChild.once('exit', (code, signal) =>
          settle({ code, signal }),
        ),
      );
      expect(childEnding.signal).toBe('SIGKILL');
      expect(process.memoryUsage().rss).toBeGreaterThan(0);
    });
  });
};
