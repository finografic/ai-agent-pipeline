import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

const chatCalls: string[] = [];
let chatResponses: string[] = [];

mock.module('../src/llm/local', () => ({
  ollamaChat: (params: { userPrompt: string }) => {
    chatCalls.push(params.userPrompt);
    const content = chatResponses.shift() ?? '{}';
    return Promise.resolve({ content, promptTokens: 10, completionTokens: 5 });
  },
}));

const { isR1Pass, runR1Review } = await import('../src/reviewers/r1-contract');

const VALID_PASS = JSON.stringify({ verdict: 'pass', unmetCriteria: [], concerns: [], confidence: 'high' });
const VALID_FAIL_LOW_CONFIDENCE = JSON.stringify({
  verdict: 'pass',
  unmetCriteria: [],
  concerns: [],
  confidence: 'low',
});

beforeEach(() => {
  chatCalls.length = 0;
  chatResponses = [];
});

afterEach(() => {
  mock.restore();
});

describe('runR1Review', () => {
  test('parses a valid pass verdict on the first attempt', async () => {
    chatResponses = [VALID_PASS];
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'diff',
      prompt: 'prompt',
    });
    expect(outcome.kind).toBe('reviewed');
    expect(isR1Pass(outcome)).toBe(true);
    expect(chatCalls.length).toBe(1);
  });

  test('treats confidence:"low" as a fail even when verdict is "pass"', async () => {
    chatResponses = [VALID_FAIL_LOW_CONFIDENCE];
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'diff',
      prompt: 'prompt',
    });
    expect(isR1Pass(outcome)).toBe(false);
  });

  test('retries once on malformed JSON, then succeeds', async () => {
    chatResponses = ['not json at all', VALID_PASS];
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'diff',
      prompt: 'prompt',
    });
    expect(outcome.kind).toBe('reviewed');
    expect(isR1Pass(outcome)).toBe(true);
    expect(chatCalls.length).toBe(2);
  });

  test('fails closed to "malformed" after a second bad response', async () => {
    chatResponses = ['not json', 'still not json'];
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'diff',
      prompt: 'prompt',
    });
    expect(outcome.kind).toBe('malformed');
    expect(chatCalls.length).toBe(2);
  });

  test('fails closed to "malformed" when JSON is valid but does not match the verdict shape', async () => {
    chatResponses = ['{"unexpected":"shape"}', '{"unexpected":"shape"}'];
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'diff',
      prompt: 'prompt',
    });
    expect(outcome.kind).toBe('malformed');
  });

  test('escalates to needs-human on an oversized diff without calling the model', async () => {
    const outcome = await runR1Review({
      baseUrl: 'http://localhost:11434',
      reviewModel: 'gpt-oss:20b',
      diff: 'x'.repeat(100),
      prompt: 'prompt',
      maxLocalDiffChars: 10,
    });
    expect(outcome).toMatchObject({ kind: 'needs-human', escalated: true });
    expect(chatCalls.length).toBe(0);
  });
});
