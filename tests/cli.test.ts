import { describe, expect, test } from 'bun:test';
import type { R0Result } from '../src/reviewers/r0-gate';
import type { R1Outcome } from '../src/reviewers/r1-contract';

import { renderGateComment } from '../src/cli';

const passingR0: R0Result = {
  passed: true,
  pending: false,
  violations: [],
  flags: [],
};

const failingR0: R0Result = {
  passed: false,
  pending: false,
  violations: [{ check: 'requiredChecks', message: 'lint failed' }],
  flags: [{ check: 'testDelta', message: 'assertions decreased', file: 'tests/example.test.ts' }],
};

const passingR1: R1Outcome = {
  kind: 'reviewed',
  escalated: false,
  promptTokens: 10,
  completionTokens: 5,
  verdict: {
    verdict: 'pass',
    unmetCriteria: [],
    concerns: [],
    confidence: 'high',
  },
};

const failingR1: R1Outcome = {
  kind: 'reviewed',
  escalated: false,
  promptTokens: 10,
  completionTokens: 5,
  verdict: {
    verdict: 'fail',
    unmetCriteria: [{ criterion: 'Update docs', why: 'ROADMAP.md was not changed' }],
    concerns: [],
    confidence: 'high',
  },
};

describe('renderGateComment', () => {
  test('marks passing gates with check icons', () => {
    expect(renderGateComment(passingR0, passingR1)).toContain('**R0:** ✅ PASS');
    expect(renderGateComment(passingR0, passingR1)).toContain('**R1:** ✅ PASS');
  });

  test('marks failing gates and warnings with visible icons', () => {
    const comment = renderGateComment(failingR0, failingR1);

    expect(comment).toContain('**R0:** ❌ FAIL');
    expect(comment).toContain('- ❌ requiredChecks: lint failed');
    expect(comment).toContain('- ⚠️ warning — testDelta: assertions decreased (`tests/example.test.ts`)');
    expect(comment).toContain('**R1:** ❌ FAIL');
  });
});
