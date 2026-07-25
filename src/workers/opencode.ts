import type { SpawnFn, Worker, WorkerInvokeParams, WorkerResult } from './types';

import { runWorkerProcess } from './types';

/**
 * Adapter for the OpenCode CLI, run non-interactively via `opencode run`. Also used
 * for cheap review passes elsewhere in the pipeline (see proposal section 3, W2/R1).
 *
 * NOTE (verified 2026-07-25 against `opencode run --help` plus https://opencode.ai/docs/cli/ —
 * not by a live invocation, which would spend real usage): `--auto` ("auto-approve permissions
 * that are not explicitly denied") is required here — without it, a permission prompt with no
 * TTY to answer it would otherwise hang the worker until the timeout kills it, same failure mode
 * `--dangerously-skip-permissions`/`--sandbox workspace-write` solve for the other two adapters.
 * `--format json` exists but its event shape isn't documented anywhere reachable, and the
 * separate `opencode stats` command has no session filter or JSON output — neither is reliably
 * attributable to a single invocation, so token/cost fields stay `null` rather than guessed
 * (brief 0.8). Revisit if a future opencode version documents either one.
 *
 * NOTE (found live, 2026-07-25): `opencode run` does **not** reliably scope itself to the
 * subprocess's OS-level `cwd` — a live run against a real worktree showed it operating against
 * this repo instead (its own persisted "last directory" state, confirmed by asking it to run
 * `git branch --show-current`/`git status` and getting this repo's branch and dirty files back).
 * `--dir <path>` fixes this — verified live from an unrelated cwd (`/tmp`) that `--dir` correctly
 * scopes every tool call to the given path regardless of process cwd. Always pass it explicitly;
 * never rely on `cwd` alone for this adapter.
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
      const cmd = ['opencode', 'run', '--auto', '--dir', worktreePath, brief];
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
