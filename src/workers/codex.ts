import type { SpawnFn, Worker, WorkerInvokeParams, WorkerResult } from './types';

import { runWorkerProcess } from './types';

interface CodexTurnCompletedEvent {
  type: 'turn.completed';
  usage?: { input_tokens?: number; output_tokens?: number };
}

/**
 * Adapter for the OpenAI Codex CLI, run non-interactively via `codex exec`.
 *
 * NOTE (verified 2026-07-25 against codex-cli 0.138.0's --help plus its public docs —
 * https://learn.chatgpt.com/docs/non-interactive-mode — not by a live invocation, which would
 * spend real API usage): `--full-auto` still runs but is a deprecated compatibility flag;
 * `--sandbox workspace-write` is the documented replacement for unattended, approval-free edits
 * within the worktree. `--json` emits JSONL events including a `turn.completed` event with a real
 * `usage.input_tokens`/`output_tokens` object — no cost field is documented anywhere in the
 * stream, so `usdEstimate` stays `null` rather than guessed (brief 0.8).
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
      const cmd = ['codex', 'exec', '--json', '--sandbox', 'workspace-write', brief];
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
      for (const line of stdout.split('\n')) {
        if (line.trim() === '') continue;
        try {
          const event = JSON.parse(line) as CodexTurnCompletedEvent;
          if (event.type === 'turn.completed') {
            inputTokens = event.usage?.input_tokens ?? null;
            outputTokens = event.usage?.output_tokens ?? null;
          }
        } catch {
          // Non-JSON or unrelated event line — ignore rather than guess (brief 0.8).
        }
      }

      return { exitCode, timedOut, inputTokens, outputTokens, usdEstimate: null };
    },
  };
}
