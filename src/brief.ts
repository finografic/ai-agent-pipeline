import { readFile } from 'node:fs/promises';

import { renderTemplate } from './utils/template.utils';

const WORKER_TEMPLATE_URL = new URL('../prompts/worker.md', import.meta.url);

/**
 * Pulls the `## Acceptance Criteria` section out of an issue body, if the human who
 * wrote it used that heading. Falls back to the full body — Phase 0 has no groomer
 * enforcing a template shape, so this is advisory, not a hard requirement on issues.
 */
export function extractAcceptanceCriteria(issueBody: string): string {
  const match = /^#{1,6}\s*acceptance criteria\s*$/im.exec(issueBody);
  if (!match) return issueBody;

  const start = match.index + match[0].length;
  const rest = issueBody.slice(start);
  const nextHeading = /^#{1,6}\s+\S/m.exec(rest);
  const section = nextHeading ? rest.slice(0, nextHeading.index) : rest;
  return section.trim() || issueBody;
}

export interface RenderDraftPrBodyParams {
  issueNumber: number;
  issueBody: string;
  round: number;
}

/** Renders the draft PR body while preserving the hidden round marker used by `gate`. */
export function renderDraftPrBody(params: RenderDraftPrBodyParams): string {
  const issueBody = params.issueBody.trim();

  return [
    '## Source Issue',
    '',
    `Closes #${params.issueNumber}`,
    '',
    '## Issue Body',
    '',
    issueBody || '_No issue body provided._',
    '',
    `<!-- agent:round=${params.round} -->`,
    '',
  ].join('\n');
}

export interface RenderReviewEvidenceParams {
  prBody: string;
  commits: Array<{ messageHeadline: string; messageBody: string }>;
}

function stripAgentMarkers(body: string): string {
  return body.replace(/<!--\s*agent:round=\d+\s*-->/gu, '').trim();
}

/** Renders non-diff evidence for R1, such as commit bodies that record verification commands. */
export function renderReviewEvidence(params: RenderReviewEvidenceParams): string {
  const prBody = stripAgentMarkers(params.prBody);
  const commitLines = params.commits.flatMap((commit, index) => {
    const body = commit.messageBody.trim();
    return [
      `#### Commit ${index + 1}: ${commit.messageHeadline}`,
      '',
      body ? body : '_No commit body provided._',
      '',
    ];
  });

  return [
    '### PR Body Evidence',
    '',
    prBody || '_No PR body provided._',
    '',
    '### Commit Message Evidence',
    '',
    ...commitLines,
  ].join('\n');
}

export interface RenderWorkerBriefParams {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  effortProfile: string;
  maxDiffLines: number;
  forbiddenPaths: string[];
  defaultBranch: string;
  handoffPath: string;
  instructionsGlob: string;
  roundContext?: string;
}

/** Renders prompts/worker.md into the scoped brief handed to a worker CLI. */
export async function renderWorkerBrief(params: RenderWorkerBriefParams): Promise<string> {
  const template = await readFile(WORKER_TEMPLATE_URL, 'utf8');
  return renderTemplate(template, {
    issueNumber: String(params.issueNumber),
    issueTitle: params.issueTitle,
    issueBody: params.issueBody,
    acceptanceCriteria: extractAcceptanceCriteria(params.issueBody),
    effortProfile: params.effortProfile,
    maxDiffLines: String(params.maxDiffLines),
    forbiddenPaths: params.forbiddenPaths.join(', '),
    defaultBranch: params.defaultBranch,
    handoffPath: params.handoffPath,
    instructionsGlob: params.instructionsGlob,
    roundContext: params.roundContext ?? '(First attempt — no prior review.)',
  });
}
