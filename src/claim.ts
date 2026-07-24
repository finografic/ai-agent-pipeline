import type { GithubClient } from './github';

export interface ClaimIssueParams {
  github: Pick<GithubClient, 'getIssue' | 'countOpenIssuesWithLabel' | 'swapIssueLabel'>;
  issueNumber: number;
  wipLimit: number;
}

export type ClaimResult = { claimed: true } | { claimed: false; reason: string };

/**
 * Brief step 0.3: verify `agent:ready`, verify the WIP limit isn't breached (counting
 * open `agent:in-progress` issues), then swap the label. Does no work on either failure.
 */
export async function claimIssue({ github, issueNumber, wipLimit }: ClaimIssueParams): Promise<ClaimResult> {
  const issue = await github.getIssue(issueNumber);
  if (!issue.labels.includes('agent:ready')) {
    return { claimed: false, reason: `Issue #${issueNumber} does not carry agent:ready` };
  }

  const inProgressCount = await github.countOpenIssuesWithLabel('agent:in-progress');
  if (inProgressCount >= wipLimit) {
    return { claimed: false, reason: `WIP limit reached (${inProgressCount}/${wipLimit})` };
  }

  await github.swapIssueLabel({ issueNumber, remove: 'agent:ready', add: 'agent:in-progress' });
  return { claimed: true };
}
