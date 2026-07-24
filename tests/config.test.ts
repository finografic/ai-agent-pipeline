import { describe, expect, test } from 'bun:test';
import type { PipelineConfig } from '../src/config';

import { findRoutingRule, parseIssueLabels, pipelineConfigSchema, RoutingNotFoundError } from '../src/config';

function validConfig(): PipelineConfig {
  return {
    repo: { slug: 'acme/widgets', path: '/tmp/widgets', defaultBranch: 'main' },
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
      forbiddenPaths: ['vault/'],
      requiredChecks: ['lint'],
      requireConventionalCommits: true,
      requireTestsFor: ['src/**/*.ts'],
    },
    routing: [
      { when: { class: ['chore'], risk: ['low'] }, worker: 'opencode', effort: 'light', reviewers: ['r0'] },
    ],
    local: {
      baseUrl: 'http://localhost:11434',
      classifyModel: 'gemma4:e4b-it-qat',
      reviewModel: 'gpt-oss:20b',
    },
  };
}

describe('pipelineConfigSchema', () => {
  test('accepts a valid config', () => {
    const result = pipelineConfigSchema.safeParse(validConfig());
    expect(result.success).toBe(true);
  });

  test('rejects a repo.slug that is not owner/repo', () => {
    const config = validConfig();
    config.repo.slug = 'not-a-slug';
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects a routing array with zero entries', () => {
    const config = validConfig();
    config.routing = [];
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects a non-positive limit', () => {
    const config = validConfig();
    config.limits.wip = 0;
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });

  test('rejects an invalid local.baseUrl', () => {
    const config = validConfig();
    config.local.baseUrl = 'not-a-url';
    const result = pipelineConfigSchema.safeParse(config);
    expect(result.success).toBe(false);
  });
});

describe('parseIssueLabels', () => {
  test('extracts class and risk from a label list', () => {
    expect(parseIssueLabels(['agent:ready', 'class:feature', 'risk:med'])).toEqual({
      class: 'feature',
      risk: 'med',
    });
  });

  test('returns undefined for missing labels', () => {
    expect(parseIssueLabels(['agent:ready'])).toEqual({ class: undefined, risk: undefined });
  });
});

describe('findRoutingRule', () => {
  test('finds the matching rule', () => {
    const config = validConfig();
    const rule = findRoutingRule(config, { class: 'chore', risk: 'low' });
    expect(rule.worker).toBe('opencode');
  });

  test('throws RoutingNotFoundError when nothing matches', () => {
    const config = validConfig();
    expect(() => findRoutingRule(config, { class: 'feature', risk: 'high' })).toThrow(RoutingNotFoundError);
  });

  test('throws RoutingNotFoundError when labels are missing entirely', () => {
    const config = validConfig();
    expect(() => findRoutingRule(config, { class: undefined, risk: undefined })).toThrow(
      RoutingNotFoundError,
    );
  });
});
