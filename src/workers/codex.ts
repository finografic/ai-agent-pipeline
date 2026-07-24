import type { SpawnFn, Worker, WorkerInvokeParams, WorkerResult } from './types';

import { runWorkerProcess } from './types';

/**
 * Adapter for the OpenAI Codex CLI, run non-interactively via `codex exec`.
 *
 * NOTE: `codex exec` does not have a verified structured-output flag in this build —
 * the CLI's own tooling is sandboxed out of reach here (see BUILD_LEDGER). Token/cost
 * fields are left `null` rather than guessed; revisit once `codex exec --help` can be
 * checked against the installed version.
 */
export function createCodexWorker(spawn?: SpawnFn): Worker {
  return {
    name: 'codex',
    async invoke({
      worktreePath,
      brief,
      model,
      timeoutMinutes,
      logPath,
    }: WorkerInvokeParams): Promise<WorkerResult> {
      const cmd = ['codex', 'exec', '--full-auto', brief];
      if (model !== undefined) cmd.push('--model', model);

      const { exitCode, timedOut } = await runWorkerProcess({
        cmd,
        cwd: worktreePath,
        timeoutMinutes,
        logPath,
        spawn,
      });

      return { exitCode, timedOut, inputTokens: null, outputTokens: null, usdEstimate: null };
    },
  };
}
