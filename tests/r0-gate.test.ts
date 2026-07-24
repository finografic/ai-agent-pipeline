import { describe, expect, test } from 'bun:test';
import type { GithubCheckRun, GithubPr } from '../src/github';
import type { R0Params } from '../src/reviewers/r0-gate';

import { runR0Gate } from '../src/reviewers/r0-gate';

function basePr(overrides: Partial<GithubPr> = {}): GithubPr {
  return {
    number: 1,
    title: 'Fix thing',
    body: 'Closes #1',
    headRefName: 'agent/1-fix-thing',
    baseRefName: 'main',
    labels: [],
    isDraft: true,
    state: 'OPEN',
    files: ['src/thing.ts'],
    additions: 10,
    deletions: 2,
    changedFiles: 1,
    commits: [{ oid: 'abc123', messageHeadline: 'fix: correct the thing', messageBody: '' }],
    ...overrides,
  };
}

function passingChecks(): () => Promise<GithubCheckRun[]> {
  return () => Promise.resolve([{ name: 'lint', bucket: 'pass' }]);
}

function baseParams(overrides: Partial<R0Params> = {}): R0Params {
  return {
    requiredChecks: ['lint'],
    forbiddenPaths: ['vault/'],
    maxDiffLines: 400,
    requireConventionalCommits: true,
    requireTestsFor: [],
    pr: basePr(),
    diff: 'diff --git a/src/thing.ts b/src/thing.ts\n+export {};\n',
    getPrChecks: passingChecks(),
    checksMaxAttempts: 2,
    checksBackoffMs: 1,
    ...overrides,
  };
}

describe('runR0Gate', () => {
  test('passes a clean PR with no violations or flags', async () => {
    const result = await runR0Gate(baseParams());
    expect(result.passed).toBe(true);
    expect(result.pending).toBe(false);
    expect(result.violations).toEqual([]);
    expect(result.flags).toEqual([]);
  });

  test('reports pending when required checks never resolve within the bounded polls', async () => {
    const result = await runR0Gate(
      baseParams({ getPrChecks: () => Promise.resolve([{ name: 'lint', bucket: 'pending' }]) }),
    );
    expect(result.pending).toBe(true);
    expect(result.passed).toBe(false);
  });

  test('fails when a required check fails, without running later checks', async () => {
    const result = await runR0Gate(
      baseParams({
        getPrChecks: () => Promise.resolve([{ name: 'lint', bucket: 'fail' }]),
        pr: basePr({ files: ['vault/secret.md'] }), // would also fail forbiddenPaths if reached
      }),
    );
    expect(result.pending).toBe(false);
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.check).toBe('requiredChecks');
  });

  test('fails on a forbidden path', async () => {
    const result = await runR0Gate(baseParams({ pr: basePr({ files: ['vault/secret.md'] }) }));
    expect(result.passed).toBe(false);
    expect(result.violations[0]).toMatchObject({ check: 'forbiddenPaths', file: 'vault/secret.md' });
  });

  test('fails when diff exceeds maxDiffLines', async () => {
    const result = await runR0Gate(
      baseParams({ pr: basePr({ additions: 300, deletions: 200 }), maxDiffLines: 400 }),
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.check).toBe('maxDiffLines');
  });

  test('fails on a non-conventional commit message', async () => {
    const result = await runR0Gate(
      baseParams({
        pr: basePr({ commits: [{ oid: 'x', messageHeadline: 'oops fixed it', messageBody: '' }] }),
      }),
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.check).toBe('conventionalCommits');
  });

  test('skips conventional-commit check when disabled', async () => {
    const result = await runR0Gate(
      baseParams({
        requireConventionalCommits: false,
        pr: basePr({ commits: [{ oid: 'x', messageHeadline: 'oops fixed it', messageBody: '' }] }),
      }),
    );
    expect(result.passed).toBe(true);
  });

  test('fails when a gated source path changes with no test file', async () => {
    const result = await runR0Gate(
      baseParams({ requireTestsFor: ['src/**/*.ts'], pr: basePr({ files: ['src/thing.ts'] }) }),
    );
    expect(result.passed).toBe(false);
    expect(result.violations[0]?.check).toBe('requireTestsFor');
  });

  test('passes when a gated source path changes alongside a test file', async () => {
    const result = await runR0Gate(
      baseParams({
        requireTestsFor: ['src/**/*.ts'],
        pr: basePr({ files: ['src/thing.ts', 'tests/thing.test.ts'] }),
      }),
    );
    expect(result.passed).toBe(true);
  });

  test('flags a deleted test file without failing the gate', async () => {
    const diff = [
      'diff --git a/tests/thing.test.ts b/tests/thing.test.ts',
      'deleted file mode 100644',
      '-expect(1).toBe(1);',
    ].join('\n');
    const result = await runR0Gate(baseParams({ pr: basePr({ files: ['tests/thing.test.ts'] }), diff }));
    expect(result.passed).toBe(true);
    expect(result.flags.length).toBe(1);
    expect(result.flags[0]?.message).toContain('deleted');
  });

  test('flags a decreased assertion count without failing the gate', async () => {
    const diff = [
      'diff --git a/tests/thing.test.ts b/tests/thing.test.ts',
      '-expect(1).toBe(1);',
      '-expect(2).toBe(2);',
      '+expect(1).toBe(1);',
    ].join('\n');
    const result = await runR0Gate(baseParams({ pr: basePr({ files: ['tests/thing.test.ts'] }), diff }));
    expect(result.passed).toBe(true);
    expect(result.flags.length).toBe(1);
    expect(result.flags[0]?.message).toContain('decreased');
  });
});
