import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

import { createOrResumeWorktree, destroyWorktree, hasNewCommits, pushBranch, slugify } from '../src/worktree';

/**
 * Everything here runs against a disposable bare+clone fixture repo created fresh
 * under the OS temp dir — never this repo's own working tree, and never a real
 * target repo. Torn down in afterAll regardless of test outcome.
 */
describe('worktree lifecycle (disposable fixture repo)', () => {
  let scratchDir: string;
  let originPath: string;
  let repoPath: string;
  let worktreeRoot: string;

  beforeAll(async () => {
    scratchDir = await mkdtemp(join(tmpdir(), 'agent-pipeline-worktree-test-'));
    originPath = join(scratchDir, 'origin.git');
    repoPath = join(scratchDir, 'checkout');
    worktreeRoot = join(scratchDir, 'worktrees');

    await $`git init -q --bare ${originPath}`.quiet();
    await $`git clone -q ${originPath} ${repoPath}`.quiet();
    await $`git -C ${repoPath} commit -q --allow-empty -m ${'chore: init fixture repo'}`.quiet();
    await $`git -C ${repoPath} push -q origin HEAD:master`.quiet();
  });

  afterAll(async () => {
    await rm(scratchDir, { recursive: true, force: true });
  });

  test('slugify produces a short, branch-safe slug', () => {
    expect(slugify('Fix the flaky WIP-limit test!!')).toBe('fix-the-flaky-wip-limit-test');
    expect(slugify('')).toBe('issue');
  });

  test('creates a fresh worktree on a new branch from the default branch', async () => {
    const worktree = await createOrResumeWorktree({
      repoPath,
      worktreeRoot,
      defaultBranch: 'master',
      issueNumber: 1,
      issueTitle: 'Add a widget',
    });

    expect(worktree.isResume).toBe(false);
    expect(worktree.branch).toBe('agent/1-add-a-widget');
    expect(await Bun.file(join(worktree.path, '.git')).exists()).toBe(true);
  });

  test('resumes the same worktree instead of recreating it', async () => {
    const first = await createOrResumeWorktree({
      repoPath,
      worktreeRoot,
      defaultBranch: 'master',
      issueNumber: 2,
      issueTitle: 'Resume me',
    });
    expect(first.isResume).toBe(false);

    const second = await createOrResumeWorktree({
      repoPath,
      worktreeRoot,
      defaultBranch: 'master',
      issueNumber: 2,
      issueTitle: 'Resume me',
    });
    expect(second.isResume).toBe(true);
    expect(second.path).toBe(first.path);
    expect(second.branch).toBe(first.branch);
  });

  test('hasNewCommits reflects actual commit state, and destroyWorktree removes it', async () => {
    const worktree = await createOrResumeWorktree({
      repoPath,
      worktreeRoot,
      defaultBranch: 'master',
      issueNumber: 3,
      issueTitle: 'Commit tracking',
    });

    expect(await hasNewCommits({ worktreePath: worktree.path, defaultBranch: 'master' })).toBe(false);

    await Bun.write(join(worktree.path, 'new-file.txt'), 'hello');
    await $`git -C ${worktree.path} add new-file.txt`.quiet();
    await $`git -C ${worktree.path} commit -q -m ${'feat: add new file'}`.quiet();

    expect(await hasNewCommits({ worktreePath: worktree.path, defaultBranch: 'master' })).toBe(true);

    await pushBranch({ worktreePath: worktree.path, branch: worktree.branch });
    const remoteBranches = await $`git -C ${repoPath} branch -r`.quiet().text();
    expect(remoteBranches).toContain(worktree.branch);

    await destroyWorktree({ repoPath, worktreePath: worktree.path, branch: worktree.branch });
    expect(await Bun.file(join(worktree.path, '.git')).exists()).toBe(false);

    const localBranches = await $`git -C ${repoPath} branch`.quiet().text();
    expect(localBranches).not.toContain(worktree.branch);
  });
});
