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
