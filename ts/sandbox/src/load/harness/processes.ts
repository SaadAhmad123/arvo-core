import { type ChildProcess, fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Child processes a check starts inside its own container: committers and
 * sweepers on one SQLite file, a writer holding it, a process killed
 * mid-commit. Each speaks to the check by messages.
 */

/** The path of a child script in `src/load/children`. */
const childScriptPath = (scriptName: string): string =>
  fileURLToPath(new URL(`../children/${scriptName}.ts`, import.meta.url));

/** A started child, its messages, and how it ended. */
export type StartedChild<Message> = {
  readonly child: ChildProcess;
  readonly messages: Message[];
  /** Settles once the child has ended, with how. */
  readonly ended: Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>;
  /** Settles with the first message matching, or rejects once the child ends without one. */
  readonly nextMessage: (
    matches: (message: Message) => boolean,
  ) => Promise<Message>;
};

/** Starts a child script with its input. */
export const startChild = <Message>(
  scriptName: string,
  input: Record<string, unknown>,
): StartedChild<Message> => {
  const child = fork(childScriptPath(scriptName), [JSON.stringify(input)], {
    execArgv: ['--import', 'tsx'],
    stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
  });
  const messages: Message[] = [];
  const waiters: {
    matches: (message: Message) => boolean;
    settle: (message: Message) => void;
  }[] = [];
  child.on('message', (message) => {
    const typedMessage = message as Message;
    messages.push(typedMessage);
    const matchedWaiters = waiters.filter((waiter) =>
      waiter.matches(typedMessage),
    );
    for (const waiter of matchedWaiters) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.settle(typedMessage);
    }
  });
  const ended = new Promise<{
    code: number | null;
    signal: NodeJS.Signals | null;
  }>((settle) =>
    child.once('exit', (code, signal) => settle({ code, signal })),
  );
  const nextMessage = (matches: (message: Message) => boolean) =>
    new Promise<Message>((settle, reject) => {
      const already = messages.find(matches);
      if (already !== undefined) {
        settle(already);
        return;
      }
      waiters.push({ matches, settle });
      void ended.then(() =>
        reject(new Error(`${scriptName} ended before the message awaited`)),
      );
    });
  return { child, messages, ended, nextMessage };
};

/** The input a child was started with. */
export const childInput = <Input>(): Input =>
  JSON.parse(process.argv[2] ?? '{}') as Input;
