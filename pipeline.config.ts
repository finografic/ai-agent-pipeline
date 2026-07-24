import type { PipelineConfig } from './src/config';

/**
 * Pipeline config for the target repo (LLAAB). Budget caps are placeholder
 * defaults — tune them once telemetry from real runs exists (brief section 10).
 */
const config: PipelineConfig = {
  repo: {
    slug: 'finografic/llaab',
    path: '/Users/justin/LLAAB',
    defaultBranch: 'master',
  },
  worktreeRoot: '~/.agent-pipeline/worktrees',
  limits: {
    wip: 1,
    maxRoundsPerIssue: 2,
    maxDiffLines: 400,
    perIssueUsdCap: 2,
    dailyUsdCap: 10,
    workerTimeoutMinutes: 30,
  },
  gates: {
    forbiddenPaths: ['vault/', 'knowledge/', '.agents/', 'scripts/macos/', 'configs/llm-routing.json'],
    requiredChecks: ['lint'],
    requireConventionalCommits: true,
    requireTestsFor: ['packages/**/src/**/*.ts', 'apps/**/src/**/*.ts'],
  },
  routing: [
    {
      when: { class: ['chore'], risk: ['low'] },
      worker: 'opencode',
      effort: 'light',
      model: 'glm-5.2',
      reviewers: ['r0'],
    },
    {
      when: { class: ['docs'], risk: ['low'] },
      worker: 'opencode',
      effort: 'light',
      model: 'glm-5.2',
      reviewers: ['r0', 'r1'],
    },
    {
      when: { class: ['test'], risk: ['low'] },
      worker: 'codex',
      effort: 'standard',
      reviewers: ['r0', 'r1'],
    },
    {
      when: { class: ['refactor', 'feature'], risk: ['med'] },
      worker: 'claude-code',
      effort: 'standard',
      model: 'claude-sonnet-5',
      reviewers: ['r0', 'r1', 'r2'],
    },
    {
      when: { class: ['refactor', 'feature'], risk: ['high'] },
      worker: 'claude-code',
      effort: 'deep',
      model: 'claude-opus-4-8',
      reviewers: ['r0', 'r1', 'r2'],
    },
  ],
  local: {
    baseUrl: 'http://localhost:11434',
    classifyModel: 'gemma4:e4b-it-qat',
    reviewModel: 'gpt-oss:20b',
  },
};

export default config;
