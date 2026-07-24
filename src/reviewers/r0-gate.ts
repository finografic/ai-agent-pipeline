import type { GithubCheckRun, GithubPr } from '../github';

export interface R0Violation {
  check: string;
  message: string;
  file?: string;
}

export interface R0Result {
  passed: boolean;
  pending: boolean;
  violations: R0Violation[];
  flags: R0Violation[];
}

export interface R0Params {
  requiredChecks: string[];
  forbiddenPaths: string[];
  maxDiffLines: number;
  requireConventionalCommits: boolean;
  requireTestsFor: string[];
  pr: GithubPr;
  diff: string;
  getPrChecks: () => Promise<GithubCheckRun[]>;
  /** Test-only overrides — production always uses the real defaults below. */
  checksMaxAttempts?: number;
  checksBackoffMs?: number;
}

const CONVENTIONAL_COMMIT_RE =
  /^(feat|fix|chore|docs|refactor|test|style|perf|build|ci|revert)(\([^)]+\))?!?: .+/;
const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|(\/(tests|__tests__)\/)/;
const ASSERTION_RE = /\b(expect|assert)\s*\(/g;

const CHECKS_MAX_ATTEMPTS = 6;
const CHECKS_BACKOFF_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function pollRequiredChecks({
  requiredChecks,
  getPrChecks,
  maxAttempts,
  backoffMs,
}: Pick<R0Params, 'requiredChecks' | 'getPrChecks'> & { maxAttempts: number; backoffMs: number }): Promise<{
  status: 'pass' | 'fail' | 'pending';
  violations: R0Violation[];
}> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const checks = await getPrChecks();
    const relevant = requiredChecks.map((name) => checks.find((check) => check.name === name));

    if (relevant.every((check) => check !== undefined)) {
      const failed = relevant.filter((check) => check.bucket === 'fail' || check.bucket === 'cancel');
      if (failed.length > 0) {
        return {
          status: 'fail',
          violations: failed.map((check) => ({
            check: 'requiredChecks',
            message: `Check "${check.name}" is ${check.bucket}`,
          })),
        };
      }
      if (relevant.every((check) => check.bucket === 'pass')) {
        return { status: 'pass', violations: [] };
      }
    }

    if (attempt < maxAttempts - 1) await sleep(backoffMs * (attempt + 1));
  }
  return {
    status: 'pending',
    violations: [
      {
        check: 'requiredChecks',
        message: `Required checks still pending after ${maxAttempts} bounded polls`,
      },
    ],
  };
}

/** Splits a unified diff into per-file blocks, keyed by the file's post-change path. */
function splitDiffByFile(diff: string): Map<string, string> {
  const blocks = new Map<string, string>();
  const parts = diff.split(/^diff --git a\/.+ b\/(.+)$/m);
  // parts[0] is preamble (usually empty); pairs are [path, blockBody, path, blockBody, ...]
  for (let i = 1; i < parts.length; i += 2) {
    const path = parts[i]?.trim();
    const body = parts[i + 1] ?? '';
    if (path !== undefined) blocks.set(path, body);
  }
  return blocks;
}

function countAssertions(text: string): number {
  return text.match(ASSERTION_RE)?.length ?? 0;
}

/** Crude heuristic: flags deleted test files and test files whose assertion count dropped. */
function checkTestIntegrity(diff: string): R0Violation[] {
  const flags: R0Violation[] = [];
  for (const [file, block] of splitDiffByFile(diff)) {
    if (!TEST_FILE_RE.test(file)) continue;

    if (/^deleted file mode/m.test(block)) {
      flags.push({ check: 'testIntegrity', message: 'Test file was deleted', file });
      continue;
    }

    const removedLines = block
      .split('\n')
      .filter((line) => line.startsWith('-') && !line.startsWith('---'))
      .join('\n');
    const addedLines = block
      .split('\n')
      .filter((line) => line.startsWith('+') && !line.startsWith('+++'))
      .join('\n');

    const before = countAssertions(removedLines);
    const after = countAssertions(addedLines);
    if (after < before) {
      flags.push({
        check: 'testIntegrity',
        message: `Assertion count may have decreased (${before} -> ${after})`,
        file,
      });
    }
  }
  return flags;
}

/**
 * Deterministic gatekeeper — no LLM. Runs the six checks in order, stopping at the
 * first hard failure. Test-integrity findings (check 6) are reported as flags,
 * never as hard failures, per the brief's explicit carve-out.
 */
export async function runR0Gate(params: R0Params): Promise<R0Result> {
  const {
    requiredChecks,
    forbiddenPaths,
    maxDiffLines,
    requireConventionalCommits,
    requireTestsFor,
    pr,
    diff,
    getPrChecks,
    checksMaxAttempts = CHECKS_MAX_ATTEMPTS,
    checksBackoffMs = CHECKS_BACKOFF_MS,
  } = params;

  const checksResult = await pollRequiredChecks({
    requiredChecks,
    getPrChecks,
    maxAttempts: checksMaxAttempts,
    backoffMs: checksBackoffMs,
  });
  if (checksResult.status === 'pending') {
    return { passed: false, pending: true, violations: checksResult.violations, flags: [] };
  }
  if (checksResult.status === 'fail') {
    return { passed: false, pending: false, violations: checksResult.violations, flags: [] };
  }

  const forbiddenHits = pr.files.filter((file) =>
    forbiddenPaths.some((forbidden) => file.startsWith(forbidden)),
  );
  if (forbiddenHits.length > 0) {
    return {
      passed: false,
      pending: false,
      violations: forbiddenHits.map((file) => ({
        check: 'forbiddenPaths',
        message: `Touches forbidden path`,
        file,
      })),
      flags: [],
    };
  }

  const diffLines = pr.additions + pr.deletions;
  if (diffLines > maxDiffLines) {
    return {
      passed: false,
      pending: false,
      violations: [
        { check: 'maxDiffLines', message: `Diff is ${diffLines} lines, exceeds limit of ${maxDiffLines}` },
      ],
      flags: [],
    };
  }

  if (requireConventionalCommits) {
    const badCommits = pr.commits.filter((commit) => !CONVENTIONAL_COMMIT_RE.test(commit.messageHeadline));
    if (badCommits.length > 0) {
      return {
        passed: false,
        pending: false,
        violations: badCommits.map((commit) => ({
          check: 'conventionalCommits',
          message: `Commit message is not conventional-commit format: "${commit.messageHeadline}"`,
        })),
        flags: [],
      };
    }
  }

  const globs = requireTestsFor.map((pattern) => new Bun.Glob(pattern));
  const touchesGatedSource = pr.files.some((file) => globs.some((glob) => glob.match(file)));
  const touchesTestFile = pr.files.some((file) => TEST_FILE_RE.test(file));
  if (touchesGatedSource && !touchesTestFile) {
    return {
      passed: false,
      pending: false,
      violations: [
        {
          check: 'requireTestsFor',
          message: 'Source under a gated path changed with no corresponding test file change',
        },
      ],
      flags: [],
    };
  }

  return { passed: true, pending: false, violations: [], flags: checkTestIntegrity(diff) };
}
