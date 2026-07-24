#!/usr/bin/env bun
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { $ } from 'bun';
import type { PipelineConfig } from './config';
import type { GithubClient, GithubPr, LabelSpec } from './github';
import type { R0Result } from './reviewers/r0-gate';
import type { R1Outcome } from './reviewers/r1-contract';
import type { TelemetryRecord } from './telemetry';
import type { Worker, WorkerName } from './workers/types';
import type { WorktreeInfo } from './worktree';

import { pc } from './utils/picocolors';
import { renderTemplate } from './utils/template.utils';

import { extractAcceptanceCriteria, renderWorkerBrief } from './brief';
import { findRoutingRule, loadConfig, parseIssueLabels } from './config';
import { createGithubClient } from './github';
import { runR0Gate } from './reviewers/r0-gate';
import { isR1Pass, runR1Review } from './reviewers/r1-contract';
import { appendTelemetryRecord, summarizeCosts } from './telemetry';
import { createClaudeCodeWorker } from './workers/claude-code';
import { createCodexWorker } from './workers/codex';
import { createOpencodeWorker } from './workers/opencode';
import {
  createOrResumeWorktree,
  destroyWorktree,
  expandHome,
  hasNewCommits,
  pushBranch,
  resolveWorktree,
} from './worktree';

const TELEMETRY_DIR = new URL('../telemetry', import.meta.url).pathname;
const ROUND_MARKER_RE = /<!--\s*agent:round=(\d+)\s*-->/;
const CLOSES_RE = /closes #(\d+)/i;

const WORKER_BINARIES: Record<WorkerName, string> = {
  'claude-code': 'claude',
  'codex': 'codex',
  'opencode': 'opencode',
};

const LABEL_SPECS: LabelSpec[] = [
  { name: 'agent:ready', color: '0e8a16', description: 'Approved for the pipeline to claim' },
  { name: 'agent:in-progress', color: 'fbca04', description: 'Claimed and being worked' },
  { name: 'agent:needs-human', color: 'd73a4a', description: 'Stopped — needs human attention' },
  { name: 'agent:approved', color: '1d76db', description: 'Passed all gates, ready to merge' },
  { name: 'class:feature', color: 'c5def5' },
  { name: 'class:refactor', color: 'c5def5' },
  { name: 'class:chore', color: 'c5def5' },
  { name: 'class:docs', color: 'c5def5' },
  { name: 'class:test', color: 'c5def5' },
  { name: 'risk:low', color: 'c2e0c6' },
  { name: 'risk:med', color: 'fef2c0' },
  { name: 'risk:high', color: 'f9c2c2' },
];

function createWorker(name: WorkerName): Worker {
  switch (name) {
    case 'claude-code':
      return createClaudeCodeWorker();
    case 'codex':
      return createCodexWorker();
    case 'opencode':
      return createOpencodeWorker();
  }
}

interface Context {
  config: PipelineConfig;
  github: GithubClient;
}

async function loadContext(): Promise<Context> {
  const config = await loadConfig();
  return { config, github: createGithubClient({ repoSlug: config.repo.slug }) };
}

async function telemetry(record: TelemetryRecord): Promise<void> {
  await appendTelemetryRecord({ telemetryDir: TELEMETRY_DIR, record });
}

// ---------- doctor ----------

interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

async function doctor(): Promise<void> {
  const { config, github } = await loadContext();
  const checks: DoctorCheck[] = [];

  const ghAuth = await $`gh auth status`.quiet().nothrow();
  checks.push({
    name: 'gh CLI authenticated',
    ok: ghAuth.exitCode === 0,
    detail: ghAuth.exitCode === 0 ? 'ok' : ghAuth.stderr.toString().trim(),
  });

  const gitVersion = await $`git --version`.quiet().nothrow();
  checks.push({
    name: 'git present',
    ok: gitVersion.exitCode === 0,
    detail: gitVersion.stdout.toString().trim() || 'not found',
  });

  const repoStatus = await $`git -C ${config.repo.path} status --porcelain`.quiet().nothrow();
  const repoBranch = await $`git -C ${config.repo.path} branch --show-current`.quiet().nothrow();
  const isClean = repoStatus.exitCode === 0 && repoStatus.stdout.toString().trim() === '';
  const currentBranch = repoBranch.stdout.toString().trim();
  checks.push({
    name: `target repo clean, on ${config.repo.defaultBranch}`,
    ok: isClean && currentBranch === config.repo.defaultBranch,
    detail: !isClean
      ? 'working tree not clean'
      : currentBranch === config.repo.defaultBranch
        ? 'ok'
        : `on branch ${currentBranch}`,
  });

  const worktreeRoot = expandHome(config.worktreeRoot);
  let worktreeRootWritable = true;
  try {
    await mkdir(worktreeRoot, { recursive: true });
    const probePath = `${worktreeRoot}/.doctor-check`;
    await writeFile(probePath, '', 'utf8');
    await rm(probePath);
  } catch {
    worktreeRootWritable = false;
  }
  checks.push({ name: 'worktree root writable', ok: worktreeRootWritable, detail: worktreeRoot });

  let ollamaOk = false;
  let ollamaDetail = 'unreachable';
  try {
    const response = await fetch(new URL('/api/tags', config.local.baseUrl));
    if (response.ok) {
      const data = (await response.json()) as { models: Array<{ name: string }> };
      const names = data.models.map((model) => model.name);
      const hasClassify = names.includes(config.local.classifyModel);
      const hasReview = names.includes(config.local.reviewModel);
      ollamaOk = hasClassify && hasReview;
      ollamaDetail = ollamaOk
        ? 'both models present'
        : `missing model(s) — have: ${names.join(', ') || '(none)'}`;
    } else {
      ollamaDetail = `HTTP ${response.status}`;
    }
  } catch (error) {
    ollamaDetail = error instanceof Error ? error.message : String(error);
  }
  checks.push({ name: 'Ollama reachable with configured models', ok: ollamaOk, detail: ollamaDetail });

  const usedWorkers = new Set(config.routing.map((rule) => rule.worker));
  for (const workerName of usedWorkers) {
    const binary = WORKER_BINARIES[workerName];
    const which = await $`which ${binary}`.quiet().nothrow();
    checks.push({
      name: `worker CLI "${binary}" present`,
      ok: which.exitCode === 0,
      detail: which.stdout.toString().trim() || 'not found',
    });
  }

  try {
    await github.ensureLabels(LABEL_SPECS);
    checks.push({
      name: 'GitHub labels ensured',
      ok: true,
      detail: LABEL_SPECS.map((label) => label.name).join(', '),
    });
  } catch (error) {
    checks.push({
      name: 'GitHub labels ensured',
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }

  for (const check of checks) {
    console.log(
      `${check.ok ? pc.green('OK  ') : pc.red('FAIL')}  ${check.name} ${pc.gray(`— ${check.detail}`)}`,
    );
  }
  if (checks.some((check) => !check.ok)) process.exit(1);
}

// ---------- shared: invoke worker + push ----------

interface InvokeWorkerAndPushParams {
  config: PipelineConfig;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  worktree: WorktreeInfo;
  workerName: WorkerName;
  model: string | undefined;
  effortProfile: string;
  roundContext?: string;
}

async function invokeWorkerAndPush(
  params: InvokeWorkerAndPushParams,
): Promise<'pushed' | 'no-commits' | 'timeout'> {
  const {
    config,
    issueNumber,
    issueTitle,
    issueBody,
    worktree,
    workerName,
    model,
    effortProfile,
    roundContext,
  } = params;

  const brief = await renderWorkerBrief({
    issueNumber,
    issueTitle,
    issueBody,
    effortProfile,
    maxDiffLines: config.limits.maxDiffLines,
    forbiddenPaths: config.gates.forbiddenPaths,
    defaultBranch: config.repo.defaultBranch,
    handoffPath: '.agents/handoff.md',
    instructionsGlob: '.github/instructions/**',
    roundContext,
  });

  const worker = createWorker(workerName);
  const startedAt = new Date().toISOString();
  const startedMs = performance.now();
  const result = await worker.invoke({
    worktreePath: worktree.path,
    brief,
    model,
    timeoutMinutes: config.limits.workerTimeoutMinutes,
    logPath: `${worktree.path}/.pipeline.log`,
  });

  await telemetry({
    issue: issueNumber,
    stage: 'invoke',
    worker: workerName,
    model: model ?? null,
    startedAt,
    durationMs: performance.now() - startedMs,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    usdEstimate: result.usdEstimate,
    outcome: result.timedOut ? 'timeout' : result.exitCode === 0 ? 'success' : 'failure',
  });

  if (result.timedOut) return 'timeout';

  const madeCommits = await hasNewCommits({
    worktreePath: worktree.path,
    defaultBranch: config.repo.defaultBranch,
  });
  if (!madeCommits) return 'no-commits';

  await pushBranch({ worktreePath: worktree.path, branch: worktree.branch });
  return 'pushed';
}

// ---------- run ----------

async function runIssue(issueNumber: number): Promise<void> {
  const { config, github } = await loadContext();

  const issue = await github.getIssue(issueNumber);
  if (!issue.labels.includes('agent:ready')) {
    console.log(pc.yellow(`Issue #${issueNumber} does not carry agent:ready — doing nothing.`));
    return;
  }

  const inProgressCount = await github.countOpenIssuesWithLabel('agent:in-progress');
  if (inProgressCount >= config.limits.wip) {
    console.log(pc.yellow(`WIP limit reached (${inProgressCount}/${config.limits.wip}) — doing nothing.`));
    return;
  }

  await github.swapIssueLabel({ issueNumber, remove: 'agent:ready', add: 'agent:in-progress' });

  const routing = findRoutingRule(config, parseIssueLabels(issue.labels));
  const worktree = await createOrResumeWorktree({
    repoPath: config.repo.path,
    worktreeRoot: config.worktreeRoot,
    defaultBranch: config.repo.defaultBranch,
    issueNumber,
    issueTitle: issue.title,
  });

  const outcome = await invokeWorkerAndPush({
    config,
    issueNumber,
    issueTitle: issue.title,
    issueBody: issue.body,
    worktree,
    workerName: routing.worker,
    model: routing.model,
    effortProfile: routing.effort,
  });

  if (outcome === 'timeout' || outcome === 'no-commits') {
    await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:needs-human' });
    const reason = outcome === 'timeout' ? 'Worker timed out' : 'Worker produced no commits';
    console.log(
      pc.red(`${reason} — labeled agent:needs-human. Worktree left at ${worktree.path} for inspection.`),
    );
    return;
  }

  const prBody = `Closes #${issueNumber}\n\n<!-- agent:round=0 -->\n`;
  const pr = await github.createDraftPr({
    branch: worktree.branch,
    base: config.repo.defaultBranch,
    title: issue.title,
    body: prBody,
  });
  console.log(pc.green(`Opened draft PR ${pr.url}`));
}

// ---------- gate ----------

function renderGateComment(r0: R0Result, r1?: R1Outcome): string {
  const lines: string[] = [r0.passed ? '**R0: pass**' : '**R0: fail**'];
  for (const violation of r0.violations) {
    lines.push(
      `- ${violation.check}: ${violation.message}${violation.file !== undefined ? ` (\`${violation.file}\`)` : ''}`,
    );
  }
  for (const flag of r0.flags) {
    lines.push(
      `- warning — ${flag.check}: ${flag.message}${flag.file !== undefined ? ` (\`${flag.file}\`)` : ''}`,
    );
  }

  if (r1 !== undefined && r1.kind === 'reviewed') {
    lines.push('', isR1Pass(r1) ? '**R1: pass**' : '**R1: fail**', `confidence: ${r1.verdict.confidence}`);
    for (const criterion of r1.verdict.unmetCriteria) {
      lines.push(`- unmet criterion: ${criterion.criterion} — ${criterion.why}`);
    }
    for (const concern of r1.verdict.concerns) {
      lines.push(`- concern: \`${concern.file}:${concern.line}\` — ${concern.note}`);
    }
  }

  return lines.join('\n');
}

interface HandleGateFailureParams {
  config: PipelineConfig;
  github: GithubClient;
  pr: GithubPr;
  prNumber: number;
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  commentBody: string;
}

async function handleGateFailure(params: HandleGateFailureParams): Promise<void> {
  const { config, github, pr, prNumber, issueNumber, issueTitle, issueBody, commentBody } = params;
  const currentRound = Number(ROUND_MARKER_RE.exec(pr.body)?.[1] ?? '0');
  const nextRound = currentRound + 1;

  if (nextRound > config.limits.maxRoundsPerIssue) {
    await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:needs-human' });
    await github.postPrComment({
      prNumber,
      body: `${commentBody}\n\nExhausted ${config.limits.maxRoundsPerIssue} review rounds — labeled agent:needs-human. Not attempting another round.`,
    });
    console.log(pc.red(`Rounds exhausted — PR #${prNumber} labeled agent:needs-human.`));
    return;
  }

  await github.postPrComment({ prNumber, body: commentBody });

  const routing = findRoutingRule(config, parseIssueLabels((await github.getIssue(issueNumber)).labels));
  const worktree = await createOrResumeWorktree({
    repoPath: config.repo.path,
    worktreeRoot: config.worktreeRoot,
    defaultBranch: config.repo.defaultBranch,
    issueNumber,
    issueTitle,
  });

  const outcome = await invokeWorkerAndPush({
    config,
    issueNumber,
    issueTitle,
    issueBody,
    worktree,
    workerName: routing.worker,
    model: routing.model,
    effortProfile: routing.effort,
    roundContext: `Round ${currentRound} review found the following. Address it, then commit:\n\n${commentBody}`,
  });

  const newBody = ROUND_MARKER_RE.test(pr.body)
    ? pr.body.replace(ROUND_MARKER_RE, `<!-- agent:round=${nextRound} -->`)
    : `${pr.body}\n<!-- agent:round=${nextRound} -->`;
  await github.updatePrBody({ prNumber, body: newBody });

  if (outcome !== 'pushed') {
    await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:needs-human' });
    console.log(pc.red(`Retry round ${nextRound} produced no new commits — labeled agent:needs-human.`));
    return;
  }
  console.log(
    pc.yellow(`Pushed round ${nextRound} fix — re-run "pipeline gate ${prNumber}" once CI settles.`),
  );
}

async function gatePr(prNumber: number): Promise<void> {
  const { config, github } = await loadContext();
  const pr = await github.getPr(prNumber);
  const diff = await github.getPrDiff(prNumber);

  const issueMatch = CLOSES_RE.exec(pr.body);
  if (!issueMatch?.[1]) {
    console.log(
      pc.red(`Could not find "Closes #N" in PR #${prNumber} body — cannot locate the source issue.`),
    );
    process.exitCode = 1;
    return;
  }
  const issueNumber = Number(issueMatch[1]);
  const issue = await github.getIssue(issueNumber);

  const r0StartedAt = new Date().toISOString();
  const r0StartedMs = performance.now();
  const r0 = await runR0Gate({
    requiredChecks: config.gates.requiredChecks,
    forbiddenPaths: config.gates.forbiddenPaths,
    maxDiffLines: config.limits.maxDiffLines,
    requireConventionalCommits: config.gates.requireConventionalCommits,
    requireTestsFor: config.gates.requireTestsFor,
    pr,
    diff,
    getPrChecks: () => github.getPrChecks(prNumber),
  });
  await telemetry({
    issue: issueNumber,
    stage: 'r0',
    worker: null,
    model: null,
    startedAt: r0StartedAt,
    durationMs: performance.now() - r0StartedMs,
    inputTokens: null,
    outputTokens: null,
    usdEstimate: 0,
    outcome: r0.pending ? 'pending' : r0.passed ? 'pass' : 'fail',
  });

  if (r0.pending) {
    console.log(pc.yellow('Required checks still pending — try gate again shortly.'));
    return;
  }
  if (!r0.passed) {
    await handleGateFailure({
      config,
      github,
      pr,
      prNumber,
      issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body,
      commentBody: renderGateComment(r0),
    });
    return;
  }

  const checklist = await readFile(new URL('../prompts/landmines/llaab.md', import.meta.url), 'utf8');
  const r1TemplateRaw = await readFile(new URL('../prompts/r1-contract.md', import.meta.url), 'utf8');
  const r1Prompt = renderTemplate(r1TemplateRaw, {
    acceptanceCriteria: extractAcceptanceCriteria(issue.body),
    checklist,
    diff,
  });

  const r1StartedAt = new Date().toISOString();
  const r1StartedMs = performance.now();
  const r1 = await runR1Review({
    baseUrl: config.local.baseUrl,
    reviewModel: config.local.reviewModel,
    diff,
    prompt: r1Prompt,
  });
  await telemetry({
    issue: issueNumber,
    stage: 'r1',
    worker: null,
    model: config.local.reviewModel,
    startedAt: r1StartedAt,
    durationMs: performance.now() - r1StartedMs,
    inputTokens: r1.kind === 'reviewed' ? r1.promptTokens : null,
    outputTokens: r1.kind === 'reviewed' ? r1.completionTokens : null,
    usdEstimate: 0,
    outcome: r1.kind === 'reviewed' ? (isR1Pass(r1) ? 'pass' : 'fail') : r1.kind,
  });

  if (r1.kind === 'malformed' || r1.kind === 'needs-human') {
    await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:needs-human' });
    const reason = r1.kind === 'malformed' ? 'R1 could not produce valid JSON after a retry' : r1.reason;
    await github.postPrComment({ prNumber, body: `${reason} — failing closed to agent:needs-human.` });
    console.log(pc.red('R1 failed closed to agent:needs-human.'));
    return;
  }

  if (!isR1Pass(r1)) {
    await handleGateFailure({
      config,
      github,
      pr,
      prNumber,
      issueNumber,
      issueTitle: issue.title,
      issueBody: issue.body,
      commentBody: renderGateComment(r0, r1),
    });
    return;
  }

  await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:approved' });
  await github.markPrReadyForReview(prNumber);
  await github.postPrComment({ prNumber, body: renderGateComment(r0, r1) });
  console.log(pc.green(`PR #${prNumber} passed R0+R1 — labeled agent:approved and marked ready for review.`));
}

// ---------- status ----------

async function showStatus(showCosts: boolean): Promise<void> {
  const { config, github } = await loadContext();

  if (showCosts) {
    const summary = await summarizeCosts({ telemetryDir: TELEMETRY_DIR });
    console.log(pc.bold(`Telemetry: ${summary.recordCount} records`));
    console.log(
      `Total: $${summary.totalUsdEstimate.toFixed(4)} · ${summary.totalInputTokens} in / ${summary.totalOutputTokens} out tokens`,
    );
    for (const [issueNumber, issueSummary] of summary.byIssue) {
      console.log(
        `  #${issueNumber}: $${issueSummary.usdEstimate.toFixed(4)} · ${issueSummary.stageCount} stage(s)`,
      );
    }
    return;
  }

  const inProgress = await github.countOpenIssuesWithLabel('agent:in-progress');
  console.log(`WIP: ${inProgress}/${config.limits.wip}`);
}

// ---------- abort ----------

async function abortIssue(issueNumber: number): Promise<void> {
  const { config, github } = await loadContext();
  const issue = await github.getIssue(issueNumber);
  const worktree = resolveWorktree({
    worktreeRoot: config.worktreeRoot,
    issueNumber,
    issueTitle: issue.title,
  });

  await destroyWorktree({ repoPath: config.repo.path, worktreePath: worktree.path, branch: worktree.branch });

  if (issue.labels.includes('agent:in-progress')) {
    await github.swapIssueLabel({ issueNumber, remove: 'agent:in-progress', add: 'agent:ready' });
  }

  await telemetry({
    issue: issueNumber,
    stage: 'abort',
    worker: null,
    model: null,
    startedAt: new Date().toISOString(),
    durationMs: 0,
    inputTokens: null,
    outputTokens: null,
    usdEstimate: null,
    outcome: 'aborted',
  });
  console.log(
    pc.yellow(`Aborted issue #${issueNumber} — worktree destroyed, claim released to agent:ready.`),
  );
}

// ---------- main ----------

function printUsage(): void {
  console.log('Usage: pipeline <doctor|run|gate|status|abort> [args]');
  console.log('  pipeline doctor');
  console.log('  pipeline run <issue-number>');
  console.log('  pipeline gate <pr-number>');
  console.log('  pipeline status [--costs]');
  console.log('  pipeline abort <issue-number>');
}

async function main(): Promise<void> {
  const [command, ...rest] = process.argv.slice(2);

  switch (command) {
    case 'doctor':
      await doctor();
      return;
    case 'run':
      await runIssue(Number(rest[0]));
      return;
    case 'gate':
      await gatePr(Number(rest[0]));
      return;
    case 'status':
      await showStatus(rest.includes('--costs'));
      return;
    case 'abort':
      await abortIssue(Number(rest[0]));
      return;
    default:
      printUsage();
      process.exit(command === undefined ? 0 : 1);
  }
}

main().catch((error: unknown) => {
  console.error(pc.red(error instanceof Error ? (error.stack ?? error.message) : String(error)));
  process.exit(1);
});
