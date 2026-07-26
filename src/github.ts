import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { $ } from 'bun';
import type { GithubAuthEnvProvider } from './github-app-auth';

export interface GithubIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  state: 'OPEN' | 'CLOSED';
}

export interface GithubCommit {
  oid: string;
  messageHeadline: string;
  messageBody: string;
}

export interface GithubPr {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  labels: string[];
  isDraft: boolean;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  files: string[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: GithubCommit[];
}

export type CheckBucket = 'pass' | 'fail' | 'pending' | 'skipping' | 'cancel';

export interface GithubCheckRun {
  name: string;
  bucket: CheckBucket;
}

export interface LabelSpec {
  name: string;
  color?: string;
  description?: string;
}

export interface CreatedPr {
  number: number;
  url: string;
}

export interface GithubClient {
  ensureLabels(labels: LabelSpec[]): Promise<void>;
  getIssue(issueNumber: number): Promise<GithubIssue>;
  countOpenIssuesWithLabel(label: string): Promise<number>;
  swapIssueLabel(params: { issueNumber: number; remove: string; add: string }): Promise<void>;
  createDraftPr(params: { branch: string; base: string; title: string; body: string }): Promise<CreatedPr>;
  getPr(prNumber: number): Promise<GithubPr>;
  getPrDiff(prNumber: number): Promise<string>;
  getPrChecks(prNumber: number): Promise<GithubCheckRun[]>;
  swapPrLabel(params: { prNumber: number; remove: string; add: string }): Promise<void>;
  postPrComment(params: { prNumber: number; body: string }): Promise<void>;
  markPrReadyForReview(prNumber: number): Promise<void>;
  updatePrBody(params: { prNumber: number; body: string }): Promise<void>;
}

const ISSUE_FIELDS = 'number,title,body,labels,state';
const PR_FIELDS =
  'number,title,body,headRefName,baseRefName,labels,isDraft,state,files,additions,deletions,changedFiles,commits';

interface RawLabel {
  name: string;
}

interface RawIssue {
  number: number;
  title: string;
  body: string;
  labels: RawLabel[];
  state: string;
}

interface RawFile {
  path: string;
}

interface RawPr {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  labels: RawLabel[];
  isDraft: boolean;
  state: string;
  files: RawFile[];
  additions: number;
  deletions: number;
  changedFiles: number;
  commits: Array<{ oid: string; messageHeadline: string; messageBody: string }>;
}

async function ghCommandEnv(authEnvProvider?: GithubAuthEnvProvider): Promise<NodeJS.ProcessEnv> {
  return authEnvProvider === undefined ? process.env : { ...process.env, ...(await authEnvProvider()) };
}

async function ghQuiet(repoSlug: string, args: string[], authEnvProvider?: GithubAuthEnvProvider) {
  return $`gh ${args} -R ${repoSlug}`.env(await ghCommandEnv(authEnvProvider)).quiet();
}

async function ghQuietNoThrow(repoSlug: string, args: string[], authEnvProvider?: GithubAuthEnvProvider) {
  return $`gh ${args} -R ${repoSlug}`
    .env(await ghCommandEnv(authEnvProvider))
    .quiet()
    .nothrow();
}

/** Runs `gh <args>` scoped to `repoSlug`, quiet (no passthrough), and returns parsed JSON stdout. */
async function ghJson<T>(
  repoSlug: string,
  args: string[],
  authEnvProvider?: GithubAuthEnvProvider,
): Promise<T> {
  const result = await ghQuiet(repoSlug, args, authEnvProvider);
  return JSON.parse(result.stdout.toString()) as T;
}

/** Runs `gh <args>` scoped to `repoSlug`, quiet, and returns raw stdout text. */
async function ghText(
  repoSlug: string,
  args: string[],
  authEnvProvider?: GithubAuthEnvProvider,
): Promise<string> {
  const result = await ghQuiet(repoSlug, args, authEnvProvider);
  return result.stdout.toString();
}

/** Writes `content` to a scratch temp file for the duration of `fn`, then cleans up. */
async function withTempFile<T>(content: string, fn: (path: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'agent-pipeline-'));
  const path = join(dir, 'body.md');
  try {
    await writeFile(path, content, 'utf8');
    return await fn(path);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function toIssue(raw: RawIssue): GithubIssue {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    labels: raw.labels.map((label) => label.name),
    state: raw.state as GithubIssue['state'],
  };
}

function toPr(raw: RawPr): GithubPr {
  return {
    number: raw.number,
    title: raw.title,
    body: raw.body,
    headRefName: raw.headRefName,
    baseRefName: raw.baseRefName,
    labels: raw.labels.map((label) => label.name),
    isDraft: raw.isDraft,
    state: raw.state as GithubPr['state'],
    files: raw.files.map((file) => file.path),
    additions: raw.additions,
    deletions: raw.deletions,
    changedFiles: raw.changedFiles,
    commits: raw.commits.map((commit) => ({
      oid: commit.oid,
      messageHeadline: commit.messageHeadline,
      messageBody: commit.messageBody,
    })),
  };
}

export interface CreateGithubClientParams {
  repoSlug: string;
  authEnvProvider?: GithubAuthEnvProvider;
}

export function createGithubClient({ repoSlug, authEnvProvider }: CreateGithubClientParams): GithubClient {
  return {
    async ensureLabels(labels) {
      for (const label of labels) {
        const args = ['label', 'create', label.name, '--force'];
        if (label.color !== undefined) args.push('--color', label.color);
        // Bun's $ array-arg interpolation mishandles an empty string element (misaligns
        // the remaining args, "too many arguments") — never push a blank description.
        if (label.description !== undefined && label.description !== '') {
          args.push('--description', label.description);
        }
        await ghQuiet(repoSlug, args, authEnvProvider);
      }
    },

    async getIssue(issueNumber) {
      const raw = await ghJson<RawIssue>(
        repoSlug,
        ['issue', 'view', String(issueNumber), '--json', ISSUE_FIELDS],
        authEnvProvider,
      );
      return toIssue(raw);
    },

    async countOpenIssuesWithLabel(label) {
      const raw = await ghJson<RawIssue[]>(
        repoSlug,
        ['issue', 'list', '--state', 'open', '--label', label, '--json', 'number'],
        authEnvProvider,
      );
      return raw.length;
    },

    async swapIssueLabel({ issueNumber, remove, add }) {
      await ghQuiet(
        repoSlug,
        ['issue', 'edit', String(issueNumber), '--remove-label', remove, '--add-label', add],
        authEnvProvider,
      );
    },

    async createDraftPr({ branch, base, title, body }) {
      const url = await withTempFile(body, (bodyPath) =>
        ghText(
          repoSlug,
          [
            'pr',
            'create',
            '--draft',
            '--base',
            base,
            '--head',
            branch,
            '--title',
            title,
            '--body-file',
            bodyPath,
          ],
          authEnvProvider,
        ),
      );
      const trimmedUrl = url.trim();
      const match = /\/pull\/(\d+)/.exec(trimmedUrl);
      if (!match) {
        throw new Error(`Could not parse PR number from gh pr create output: ${trimmedUrl}`);
      }
      return { number: Number(match[1]), url: trimmedUrl };
    },

    async getPr(prNumber) {
      const raw = await ghJson<RawPr>(
        repoSlug,
        ['pr', 'view', String(prNumber), '--json', PR_FIELDS],
        authEnvProvider,
      );
      return toPr(raw);
    },

    async getPrDiff(prNumber) {
      return ghText(repoSlug, ['pr', 'diff', String(prNumber)], authEnvProvider);
    },

    async getPrChecks(prNumber) {
      const result = await ghQuietNoThrow(
        repoSlug,
        ['pr', 'checks', String(prNumber), '--json', 'name,bucket'],
        authEnvProvider,
      );
      // Exit code 8 means "checks pending" — still valid JSON on stdout, not a failure.
      if (result.exitCode !== 0 && result.exitCode !== 8) {
        throw new Error(`gh pr checks failed (exit ${result.exitCode}): ${result.stderr.toString()}`);
      }
      return JSON.parse(result.stdout.toString()) as GithubCheckRun[];
    },

    async swapPrLabel({ prNumber, remove, add }) {
      await ghQuiet(
        repoSlug,
        ['pr', 'edit', String(prNumber), '--remove-label', remove, '--add-label', add],
        authEnvProvider,
      );
    },

    async postPrComment({ prNumber, body }) {
      await withTempFile(body, (bodyPath) =>
        ghQuiet(repoSlug, ['pr', 'comment', String(prNumber), '--body-file', bodyPath], authEnvProvider),
      );
    },

    async markPrReadyForReview(prNumber) {
      await ghQuiet(repoSlug, ['pr', 'ready', String(prNumber)], authEnvProvider);
    },

    async updatePrBody({ prNumber, body }) {
      await withTempFile(body, (bodyPath) =>
        ghQuiet(repoSlug, ['pr', 'edit', String(prNumber), '--body-file', bodyPath], authEnvProvider),
      );
    },
  };
}
