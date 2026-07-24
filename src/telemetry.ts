import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface TelemetryRecord {
  issue: number;
  stage: string;
  worker: string | null;
  model: string | null;
  startedAt: string;
  durationMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  usdEstimate: number | null;
  outcome: string;
}

export interface AppendTelemetryParams {
  telemetryDir: string;
  record: TelemetryRecord;
}

/** Appends one JSONL record to `telemetry/<date>.jsonl`, keyed by the record's own startedAt date. */
export async function appendTelemetryRecord({ telemetryDir, record }: AppendTelemetryParams): Promise<void> {
  await mkdir(telemetryDir, { recursive: true });
  const date = record.startedAt.slice(0, 10);
  const filePath = join(telemetryDir, `${date}.jsonl`);
  await appendFile(filePath, `${JSON.stringify(record)}\n`, 'utf8');
}

export interface IssueCostSummary {
  usdEstimate: number;
  inputTokens: number;
  outputTokens: number;
  stageCount: number;
}

export interface CostSummary {
  recordCount: number;
  totalUsdEstimate: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  byIssue: Map<number, IssueCostSummary>;
}

export interface SummarizeCostsParams {
  telemetryDir: string;
  limitFiles?: number;
}

/** Reads recent telemetry JSONL files and aggregates cost/token totals, for `pipeline status --costs`. */
export async function summarizeCosts({
  telemetryDir,
  limitFiles,
}: SummarizeCostsParams): Promise<CostSummary> {
  const summary: CostSummary = {
    recordCount: 0,
    totalUsdEstimate: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    byIssue: new Map(),
  };

  let entries: string[];
  try {
    entries = (await readdir(telemetryDir))
      .filter((name) => name.endsWith('.jsonl'))
      .sort()
      .reverse();
  } catch {
    return summary;
  }
  const selected = limitFiles !== undefined ? entries.slice(0, limitFiles) : entries;

  for (const fileName of selected) {
    const text = await readFile(join(telemetryDir, fileName), 'utf8');
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      const record = JSON.parse(line) as TelemetryRecord;
      summary.recordCount += 1;
      summary.totalUsdEstimate += record.usdEstimate ?? 0;
      summary.totalInputTokens += record.inputTokens ?? 0;
      summary.totalOutputTokens += record.outputTokens ?? 0;

      const existing = summary.byIssue.get(record.issue) ?? {
        usdEstimate: 0,
        inputTokens: 0,
        outputTokens: 0,
        stageCount: 0,
      };
      existing.usdEstimate += record.usdEstimate ?? 0;
      existing.inputTokens += record.inputTokens ?? 0;
      existing.outputTokens += record.outputTokens ?? 0;
      existing.stageCount += 1;
      summary.byIssue.set(record.issue, existing);
    }
  }

  return summary;
}
