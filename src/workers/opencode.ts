import type { SpawnFn, Worker, WorkerInvokeParams, WorkerResult } from './types';

import { runWorkerProcess } from './types';

/**
 * Adapter for the OpenCode CLI, run non-interactively via `opencode run`. Also used
 * for cheap review passes elsewhere in the pipeline (see proposal section 3, W2/R1).
 *
 * NOTE: `opencode run` does not have a verified structured-output flag in this build — the CLI's
 * own tooling was sandboxed out of reach here (see the Open Questions in `.agents/handoff.md`
 * and `docs/todo/NEXT_STEPS.md`). Token/cost fields are left `null` rather than guessed; revisit
 * once `opencode --help` can be checked against the installed version.
 */
export function createOpencodeWorker(spawn?: SpawnFn): Worker {
  return {
    name: 'opencode',
    async invoke({
      worktreePath,
      brief,
      model,
      timeoutMinutes,
      logPath,
    }: WorkerInvokeParams): Promise<WorkerResult> {
      const cmd = ['opencode', 'run', brief];
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
