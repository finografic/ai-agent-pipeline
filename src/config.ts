import { z } from 'zod';

const workerNameSchema = z.enum(['claude-code', 'codex', 'opencode']);
const effortProfileSchema = z.enum(['light', 'standard', 'deep']);
const reviewerNameSchema = z.enum(['r0', 'r1', 'r2']);

const routingRuleSchema = z.object({
  when: z.object({
    class: z.array(z.string().min(1)).min(1),
    risk: z.array(z.string().min(1)).min(1),
  }),
  worker: workerNameSchema,
  effort: effortProfileSchema,
  model: z.string().min(1).optional(),
  reviewers: z.array(reviewerNameSchema).min(1),
});

export const pipelineConfigSchema = z.object({
  repo: z.object({
    slug: z.string().regex(/^[^/\s]+\/[^/\s]+$/, 'expected "owner/repo"'),
    path: z.string().min(1),
    defaultBranch: z.string().min(1),
  }),
  worktreeRoot: z.string().min(1),
  limits: z.object({
    wip: z.number().int().positive(),
    maxRoundsPerIssue: z.number().int().positive(),
    maxDiffLines: z.number().int().positive(),
    perIssueUsdCap: z.number().positive(),
    dailyUsdCap: z.number().positive(),
    workerTimeoutMinutes: z.number().int().positive(),
  }),
  gates: z.object({
    forbiddenPaths: z.array(z.string().min(1)),
    requiredChecks: z.array(z.string().min(1)),
    requireConventionalCommits: z.boolean(),
    requireTestsFor: z.array(z.string().min(1)),
  }),
  routing: z.array(routingRuleSchema).min(1),
  local: z.object({
    baseUrl: z.url(),
    classifyModel: z.string().min(1),
    reviewModel: z.string().min(1),
  }),
});

export type PipelineConfig = z.infer<typeof pipelineConfigSchema>;
export type RoutingRule = z.infer<typeof routingRuleSchema>;
export type WorkerName = z.infer<typeof workerNameSchema>;
export type EffortProfile = z.infer<typeof effortProfileSchema>;
export type ReviewerName = z.infer<typeof reviewerNameSchema>;

export class ConfigValidationError extends Error {
  constructor(
    configPath: string,
    readonly issues: z.ZodIssue[],
  ) {
    const detail = issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    super(`Invalid pipeline config at ${configPath}:\n${detail}`);
    this.name = 'ConfigValidationError';
  }
}

const defaultConfigUrl = new URL('../pipeline.config.ts', import.meta.url);

export interface LoadConfigParams {
  configPath?: string;
}

export async function loadConfig({ configPath }: LoadConfigParams = {}): Promise<PipelineConfig> {
  const resolvedPath = configPath ?? process.env.PIPELINE_CONFIG_PATH ?? defaultConfigUrl.pathname;
  const mod: unknown = await import(resolvedPath);
  const candidate = (mod as { default?: unknown }).default;
  const result = pipelineConfigSchema.safeParse(candidate);
  if (!result.success) {
    throw new ConfigValidationError(resolvedPath, result.error.issues);
  }
  return result.data;
}

export interface IssueLabelsInfo {
  class: string | undefined;
  risk: string | undefined;
}

/** Extracts the `class:<x>` and `risk:<x>` labels a GitHub issue is expected to carry. */
export function parseIssueLabels(labels: string[]): IssueLabelsInfo {
  const classLabel = labels.find((label) => label.startsWith('class:'));
  const riskLabel = labels.find((label) => label.startsWith('risk:'));
  return {
    class: classLabel?.slice('class:'.length),
    risk: riskLabel?.slice('risk:'.length),
  };
}

export class RoutingNotFoundError extends Error {
  constructor(info: IssueLabelsInfo) {
    super(
      `No routing rule matches class=${info.class ?? '(missing)'} risk=${info.risk ?? '(missing)'}. ` +
        `Add matching class:* and risk:* labels to the issue, or add a routing rule to pipeline.config.ts.`,
    );
    this.name = 'RoutingNotFoundError';
  }
}

/** Finds the first routing rule whose `when` matches the issue's class/risk labels. */
export function findRoutingRule(config: PipelineConfig, info: IssueLabelsInfo): RoutingRule {
  const { class: issueClass, risk: issueRisk } = info;
  const match =
    issueClass !== undefined && issueRisk !== undefined
      ? config.routing.find(
          (rule) => rule.when.class.includes(issueClass) && rule.when.risk.includes(issueRisk),
        )
      : undefined;
  if (!match) {
    throw new RoutingNotFoundError(info);
  }
  return match;
}
