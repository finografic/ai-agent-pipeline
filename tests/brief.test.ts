import { describe, expect, test } from 'bun:test';

import {
  extractAcceptanceCriteria,
  renderDraftPrBody,
  renderReviewEvidence,
  renderWorkerBrief,
} from '../src/brief';

describe('extractAcceptanceCriteria', () => {
  test('extracts a dedicated acceptance criteria section', () => {
    const body = [
      '## Summary',
      '',
      'Do the thing.',
      '',
      '## Acceptance Criteria',
      '',
      '- [ ] First',
      '- [ ] Second',
      '',
      '## Notes',
      '',
      'Later text.',
    ].join('\n');

    expect(extractAcceptanceCriteria(body)).toBe('- [ ] First\n- [ ] Second');
  });

  test('falls back to the whole body when no acceptance criteria heading exists', () => {
    expect(extractAcceptanceCriteria('Just do the thing.')).toBe('Just do the thing.');
  });
});

describe('renderDraftPrBody', () => {
  test('copies the issue body and keeps the closing keyword plus round marker', () => {
    const body = renderDraftPrBody({
      issueNumber: 42,
      issueBody: '## Summary\n\nDo the thing.\n\n## Acceptance Criteria\n\n- [ ] Done',
      round: 0,
    });

    expect(body).toContain('## Source Issue\n\nCloses #42');
    expect(body).toContain('## Issue Body\n\n## Summary\n\nDo the thing.');
    expect(body).toContain('## Acceptance Criteria\n\n- [ ] Done');
    expect(body).toContain('<!-- agent:round=0 -->');
  });

  test('omits the issue body section when the issue body is blank', () => {
    const body = renderDraftPrBody({ issueNumber: 7, issueBody: '  ', round: 0 });

    expect(body).toContain('## Source Issue\n\nCloses #7');
    expect(body).not.toContain('## Issue Body');
    expect(body).not.toContain('_No issue body provided._');
    expect(body).toContain('<!-- agent:round=0 -->');
  });
});

describe('renderReviewEvidence', () => {
  test('includes PR body and commit messages while stripping agent round markers', () => {
    const body = renderReviewEvidence({
      prBody: 'Closes #42\n\n<!-- agent:round=1 -->',
      commits: [
        {
          messageHeadline: 'docs(todo): graduate plan',
          messageBody: 'Verified: rg TODO_PLAN returned no docs matches.',
        },
      ],
    });

    expect(body).toContain('### PR Body Evidence\n\nCloses #42');
    expect(body).not.toContain('agent:round');
    expect(body).toContain('#### Commit 1: docs(todo): graduate plan');
    expect(body).toContain('Verified: rg TODO_PLAN returned no docs matches.');
  });
});

describe('renderWorkerBrief', () => {
  test('requires dirty changes to be committed before final response', async () => {
    const body = await renderWorkerBrief({
      issueNumber: 42,
      issueTitle: 'Document the thing',
      issueBody: '## Acceptance Criteria\n\n- Update docs',
      effortProfile: 'small',
      maxDiffLines: 400,
      forbiddenPaths: ['vault/'],
      defaultBranch: 'master',
      handoffPath: '.agents/handoff.md',
      instructionsGlob: '.github/instructions/**',
    });

    expect(body).toContain('Before your final response, run `git status --short`');
    expect(body).toContain('A final response with dirty or staged-but-uncommitted changes is a failed run.');
  });
});
