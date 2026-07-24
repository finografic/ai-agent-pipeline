import { open } from 'node:fs/promises';
import { $ } from 'bun';

export type WorkerName = 'claude-code' | 'codex' | 'opencode';

export interface WorkerInvokeParams {
  worktreePath: string;
  brief: string;
  model: string | undefined;
  timeoutMinutes: number;
  logPath: string;
}

export interface WorkerResult {
  timedOut: boolean;
  exitCode: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  usdEstimate: number | null;
}

export interface Worker {
  readonly name: WorkerName;
  invoke(params: WorkerInvokeParams): Promise<WorkerResult>;
}

/** Injectable subprocess spawner so tests never invoke a real agent CLI. */
export type SpawnFn = (
  cmd: string[],
  options: { cwd: string; stdin: 'ignore' },
) => Bun.Subprocess<'ignore', 'pipe', 'pipe'>;

const defaultSpawn: SpawnFn = (cmd, options) =>
  Bun.spawn(cmd, { ...options, stdout: 'pipe', stderr: 'pipe' });

/** Best-effort process-tree kill: SIGTERM to direct children, then SIGKILL to the process itself. */
async function killProcessTree(pid: number): Promise<void> {
  await $`pkill -TERM -P ${pid}`.quiet().nothrow();
  await $`kill -KILL ${pid}`.quiet().nothrow();
}

export interface RunWorkerProcessParams {
  cmd: string[];
  cwd: string;
  timeoutMinutes: number;
  logPath: string;
  spawn?: SpawnFn;
}

export interface RunWorkerProcessResult {
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
}

/**
 * Runs a worker CLI as a non-interactive subprocess, streaming combined output to
 * `logPath` and capturing stdout separately for token/cost parsing. Enforces a hard
 * timeout: on expiry the process tree is killed and `timedOut` is reported true.
 */
export async function runWorkerProcess({
  cmd,
  cwd,
  timeoutMinutes,
  logPath,
  spawn = defaultSpawn,
}: RunWorkerProcessParams): Promise<RunWorkerProcessResult> {
  const logHandle = await open(logPath, 'a');
  const proc = spawn(cmd, { cwd, stdin: 'ignore' });

  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    void killProcessTree(proc.pid);
  }, timeoutMinutes * 60_000);

  const stdoutChunks: Uint8Array[] = [];
  const pump = async (stream: ReadableStream<Uint8Array>, capture: boolean) => {
    for await (const chunk of stream) {
      await logHandle.write(chunk);
      if (capture) stdoutChunks.push(chunk);
    }
  };

  await Promise.all([pump(proc.stdout, true), pump(proc.stderr, false)]);
  const exitCode = await proc.exited;
  clearTimeout(timer);
  await logHandle.close();

  const stdout = Buffer.concat(stdoutChunks).toString('utf8');
  return { exitCode: timedOut ? null : exitCode, timedOut, stdout };
}
