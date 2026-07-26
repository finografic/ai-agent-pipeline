import { afterEach, describe, expect, test } from 'bun:test';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createGithubAppAuthEnvProvider,
  createGithubAppJwt,
  loadGithubAppAuthConfig,
} from '../src/github-app-auth';

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function createPrivateKey(): string {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return privateKey.export({ format: 'pem', type: 'pkcs1' }).toString();
}

function decodeJwtPart<T>(value: string): T {
  return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as T;
}

describe('loadGithubAppAuthConfig', () => {
  test('loads app auth config from a user-level env file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-pipeline-auth-test-'));
    const envPath = join(dir, '.env');
    try {
      await writeFile(
        envPath,
        [
          'GITHUB_APP_ID=123',
          'GITHUB_APP_INSTALLATION_ID=456',
          'GITHUB_APP_PRIVATE_KEY_PATH=/tmp/key.pem',
        ].join('\n'),
      );

      const config = await loadGithubAppAuthConfig({ configPath: envPath });
      expect(config).toEqual({
        appId: '123',
        installationId: '456',
        privateKeyPath: '/tmp/key.pem',
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test('returns undefined when no app auth config exists', async () => {
    const config = await loadGithubAppAuthConfig({ configPath: '/tmp/does-not-exist.env' });
    expect(config).toBeUndefined();
  });
});

describe('createGithubAppJwt', () => {
  test('creates an RS256 GitHub App JWT with the app id as issuer', () => {
    const token = createGithubAppJwt({
      appId: '123',
      privateKey: createPrivateKey(),
      nowMs: 1_700_000_000_000,
    });
    const [header, payload, signature] = token.split('.');

    expect(decodeJwtPart<{ alg: string; typ: string }>(header ?? '')).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(decodeJwtPart<{ iat: number; exp: number; iss: string }>(payload ?? '')).toEqual({
      iat: 1_699_999_940,
      exp: 1_700_000_540,
      iss: '123',
    });
    expect(signature?.length).toBeGreaterThan(0);
  });
});

describe('createGithubAppAuthEnvProvider', () => {
  test('returns cached GH_TOKEN env until the installation token nears expiry', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agent-pipeline-auth-provider-test-'));
    const keyPath = join(dir, 'key.pem');
    let nowMs = 1_700_000_000_000;
    let callCount = 0;

    try {
      await writeFile(keyPath, createPrivateKey());
      const provider = createGithubAppAuthEnvProvider({
        config: { appId: '123', installationId: '456', privateKeyPath: keyPath },
        nowMs: () => nowMs,
        fetchImpl: (() => {
          callCount += 1;
          return Promise.resolve(
            new Response(
              JSON.stringify({
                token: `token-${callCount}`,
                expires_at: new Date(nowMs + 120_000).toISOString(),
              }),
              { status: 201 },
            ),
          );
        }) as unknown as typeof fetch,
      });

      expect(await provider()).toEqual({ GH_TOKEN: 'token-1' });
      expect(await provider()).toEqual({ GH_TOKEN: 'token-1' });

      nowMs += 70_000;

      expect(await provider()).toEqual({ GH_TOKEN: 'token-2' });
      expect(callCount).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
