import type { SpawnFn, Worker, WorkerInvokeParams, WorkerResult } from './types';

import { runWorkerProcess } from './types';

interface ClaudeJsonResult {
  usage?: { input_tokens?: number; output_tokens?: number };
  total_cost_usd?: number;
}

/** Adapter for the Claude Code CLI, run non-interactively via `-p`/`--output-format json`. */
export function createClaudeCodeWorker(spawn?: SpawnFn): Worker {
  return {
    name: 'claude-code',
    async invoke({
      worktreePath,
      brief,
      model,
      timeoutMinutes,
      logPath,
    }: WorkerInvokeParams): Promise<WorkerResult> {
      const cmd = ['claude', '-p', brief, '--output-format', 'json', '--dangerously-skip-permissions'];
      if (model !== undefined) cmd.push('--model', model);

      const { exitCode, timedOut, stdout } = await runWorkerProcess({
        cmd,
        cwd: worktreePath,
        timeoutMinutes,
        logPath,
        spawn,
      });

      let inputTokens: number | null = null;
      let outputTokens: number | null = null;
      let usdEstimate: number | null = null;
      try {
        const parsed = JSON.parse(stdout) as ClaudeJsonResult;
        inputTokens = parsed.usage?.input_tokens ?? null;
        outputTokens = parsed.usage?.output_tokens ?? null;
        usdEstimate = parsed.total_cost_usd ?? null;
      } catch {
        // Output didn't match the expected JSON shape — record null, never guess (brief 0.8).
      }

      return { exitCode, timedOut, inputTokens, outputTokens, usdEstimate };
    },
  };
}
