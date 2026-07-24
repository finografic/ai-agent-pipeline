import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';

export interface WorktreeInfo {
  path: string;
  branch: string;
  isResume: boolean;
}

export interface CreateOrResumeWorktreeParams {
  repoPath: string;
  worktreeRoot: string;
  defaultBranch: string;
  issueNumber: number;
  issueTitle: string;
}

export interface DestroyWorktreeParams {
  repoPath: string;
  worktreePath: string;
  branch: string;
}

/** Expands a leading `~` to the current user's home directory. */
export function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

/** Turns an issue title into a short, branch-safe slug. */
export function slugify(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.slice(0, 40).replace(/-+$/, '') || 'issue';
}

export interface ResolveWorktreeParams {
  worktreeRoot: string;
  issueNumber: number;
  issueTitle: string;
}

/** Computes an issue's deterministic worktree path + branch name without touching git. */
export function resolveWorktree({ worktreeRoot, issueNumber, issueTitle }: ResolveWorktreeParams): {
  path: string;
  branch: string;
} {
  const slug = slugify(issueTitle);
  return {
    path: join(expandHome(worktreeRoot), `${issueNumber}-${slug}`),
    branch: `agent/${issueNumber}-${slug}`,
  };
}

/**
 * Creates a fresh worktree from the target repo's default branch, or resumes an
 * existing one for the same issue. Never operates on `repoPath` itself — always
 * a sibling checkout under `worktreeRoot`.
 */
export async function createOrResumeWorktree({
  repoPath,
  worktreeRoot,
  defaultBranch,
  issueNumber,
  issueTitle,
}: CreateOrResumeWorktreeParams): Promise<WorktreeInfo> {
  const { path: worktreePath, branch } = resolveWorktree({ worktreeRoot, issueNumber, issueTitle });

  if (existsSync(worktreePath)) {
    return { path: worktreePath, branch, isResume: true };
  }

  await mkdir(expandHome(worktreeRoot), { recursive: true });
  await $`git -C ${repoPath} fetch origin ${defaultBranch}`.quiet();
  await $`git -C ${repoPath} worktree add -b ${branch} ${worktreePath} origin/${defaultBranch}`.quiet();

  return { path: worktreePath, branch, isResume: false };
}

/** Removes a worktree and its branch. Used only by explicit teardown (e.g. `pipeline abort`). */
export async function destroyWorktree({
  repoPath,
  worktreePath,
  branch,
}: DestroyWorktreeParams): Promise<void> {
  await $`git -C ${repoPath} worktree remove ${worktreePath} --force`.quiet().nothrow();
  await $`git -C ${repoPath} branch -D ${branch}`.quiet().nothrow();
}

export interface HasNewCommitsParams {
  worktreePath: string;
  defaultBranch: string;
}

/** True if the worktree's branch has commits beyond the default branch it forked from. */
export async function hasNewCommits({ worktreePath, defaultBranch }: HasNewCommitsParams): Promise<boolean> {
  const result = await $`git -C ${worktreePath} rev-list --count origin/${defaultBranch}..HEAD`
    .quiet()
    .text();
  return Number(result.trim()) > 0;
}

export interface PushBranchParams {
  worktreePath: string;
  branch: string;
}

/** Pushes the worktree's branch to origin, setting upstream on first push. */
export async function pushBranch({ worktreePath, branch }: PushBranchParams): Promise<void> {
  await $`git -C ${worktreePath} push --set-upstream origin ${branch}`.quiet();
}
