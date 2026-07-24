import { z } from 'zod';

import { ollamaChat } from '../llm/local';

const r1VerdictSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  unmetCriteria: z.array(z.object({ criterion: z.string(), why: z.string() })),
  concerns: z.array(z.object({ file: z.string(), line: z.number(), note: z.string() })),
  confidence: z.enum(['high', 'low']),
});

export type R1Verdict = z.infer<typeof r1VerdictSchema>;

export type R1Outcome =
  | {
      kind: 'reviewed';
      verdict: R1Verdict;
      escalated: false;
      promptTokens: number | null;
      completionTokens: number | null;
    }
  | { kind: 'malformed'; escalated: false }
  | { kind: 'needs-human'; escalated: true; reason: string };

export interface R1Params {
  baseUrl: string;
  reviewModel: string;
  /** Full diff text — used only to decide whether it fits the local model's comfortable window. */
  diff: string;
  /** Fully rendered prompts/r1-contract.md — acceptance criteria + checklist + diff, nothing else. */
  prompt: string;
  maxLocalDiffChars?: number;
}

const DEFAULT_MAX_LOCAL_DIFF_CHARS = 60_000;
const MAX_ATTEMPTS = 2;

function tryParseVerdict(content: string): R1Verdict | undefined {
  try {
    const result = r1VerdictSchema.safeParse(JSON.parse(content));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Contract reviewer: does the diff satisfy the issue's acceptance criteria? Context is
 * exactly what the caller renders into `prompt` — no repo dump, no worker reasoning.
 * Retries once on malformed JSON, then fails closed to needs-human.
 *
 * There is no remote-model fallback wired up in Phase 0/1 (the config schema has no
 * "remote" section — see brief section 2) — an oversized diff also fails closed to
 * needs-human, with `escalated: true` recorded so telemetry shows the attempted
 * escalation. Wiring a real cheap-remote client is a clean Phase 2+ extension point.
 */
export async function runR1Review(params: R1Params): Promise<R1Outcome> {
  const maxChars = params.maxLocalDiffChars ?? DEFAULT_MAX_LOCAL_DIFF_CHARS;
  if (params.diff.length > maxChars) {
    return {
      kind: 'needs-human',
      escalated: true,
      reason: `Diff is ${params.diff.length} chars, exceeds the local model's comfortable window (${maxChars}) and no remote reviewer is configured in Phase 0/1`,
    };
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const { content, promptTokens, completionTokens } = await ollamaChat({
      baseUrl: params.baseUrl,
      model: params.reviewModel,
      userPrompt: params.prompt,
      json: true,
    });

    const verdict = tryParseVerdict(content);
    if (verdict) {
      return { kind: 'reviewed', verdict, escalated: false, promptTokens, completionTokens };
    }
  }

  return { kind: 'malformed', escalated: false };
}

/** Confidence:"low" is treated as a fail — routes to a human, the correct cheap answer. */
export function isR1Pass(outcome: R1Outcome): boolean {
  return (
    outcome.kind === 'reviewed' && outcome.verdict.verdict === 'pass' && outcome.verdict.confidence === 'high'
  );
}
