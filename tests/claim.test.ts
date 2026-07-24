import { describe, expect, test } from 'bun:test';
import type { GithubClient, GithubIssue } from '../src/github';

import { claimIssue } from '../src/claim';

interface FakeGithub {
  github: Pick<GithubClient, 'getIssue' | 'countOpenIssuesWithLabel' | 'swapIssueLabel'>;
  swapCalls: Array<{ issueNumber: number; remove: string; add: string }>;
}

function fakeGithub({ issue, inProgressCount }: { issue: GithubIssue; inProgressCount: number }): FakeGithub {
  const swapCalls: Array<{ issueNumber: number; remove: string; add: string }> = [];
  return {
    swapCalls,
    github: {
      getIssue: () => Promise.resolve(issue),
      countOpenIssuesWithLabel: () => Promise.resolve(inProgressCount),
      swapIssueLabel: (params) => {
        swapCalls.push(params);
        return Promise.resolve();
      },
    },
  };
}

const readyIssue: GithubIssue = {
  number: 42,
  title: 'Do the thing',
  body: '',
  labels: ['agent:ready'],
  state: 'OPEN',
};

describe('claimIssue', () => {
  test('claims when agent:ready is present and WIP is under the limit', async () => {
    const { github, swapCalls } = fakeGithub({ issue: readyIssue, inProgressCount: 0 });
    const result = await claimIssue({ github, issueNumber: 42, wipLimit: 1 });

    expect(result).toEqual({ claimed: true });
    expect(swapCalls).toEqual([{ issueNumber: 42, remove: 'agent:ready', add: 'agent:in-progress' }]);
  });

  test('does not claim when the issue lacks agent:ready', async () => {
    const notReady: GithubIssue = { ...readyIssue, labels: [] };
    const { github, swapCalls } = fakeGithub({ issue: notReady, inProgressCount: 0 });
    const result = await claimIssue({ github, issueNumber: 42, wipLimit: 1 });

    expect(result.claimed).toBe(false);
    expect(swapCalls).toEqual([]);
  });

  test('does not claim when the WIP limit is already reached', async () => {
    const { github, swapCalls } = fakeGithub({ issue: readyIssue, inProgressCount: 1 });
    const result = await claimIssue({ github, issueNumber: 42, wipLimit: 1 });

    expect(result).toEqual({ claimed: false, reason: 'WIP limit reached (1/1)' });
    expect(swapCalls).toEqual([]);
  });

  test('does not claim when the WIP limit is exceeded', async () => {
    const { github, swapCalls } = fakeGithub({ issue: readyIssue, inProgressCount: 3 });
    const result = await claimIssue({ github, issueNumber: 42, wipLimit: 1 });

    expect(result.claimed).toBe(false);
    expect(swapCalls).toEqual([]);
  });

  test('claims correctly at a higher configured WIP limit', async () => {
    const { github, swapCalls } = fakeGithub({ issue: readyIssue, inProgressCount: 1 });
    const result = await claimIssue({ github, issueNumber: 42, wipLimit: 2 });

    expect(result).toEqual({ claimed: true });
    expect(swapCalls.length).toBe(1);
  });
});
