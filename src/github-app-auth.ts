import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface GithubAppAuthConfig {
  appId: string;
  installationId: string;
  privateKeyPath: string;
}

export interface GithubAppInstallationToken {
  token: string;
  expiresAt: string;
}

export type GithubAuthEnvProvider = () => Promise<Record<string, string>>;

const DEFAULT_CONFIG_PATH = join(homedir(), '.config/finografic/ai-agent-pipeline/.env');
const GITHUB_API_VERSION = '2022-11-28';
const TOKEN_REFRESH_SKEW_MS = 60_000;

function parseEnvFile(content: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#')) continue;

    const equalsIndex = line.indexOf('=');
    if (equalsIndex === -1) continue;

    const key = line.slice(0, equalsIndex).trim();
    const rawValue = line.slice(equalsIndex + 1).trim();
    const value =
      (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
      (rawValue.startsWith("'") && rawValue.endsWith("'"))
        ? rawValue.slice(1, -1)
        : rawValue;

    if (key !== '') values[key] = value;
  }
  return values;
}

async function readOptionalEnvFile(path: string): Promise<Record<string, string>> {
  try {
    return parseEnvFile(await readFile(path, 'utf8'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
}

function envValue(fileEnv: Record<string, string>, key: string): string | undefined {
  return process.env[key] ?? fileEnv[key];
}

export interface LoadGithubAppAuthConfigParams {
  configPath?: string;
}

export async function loadGithubAppAuthConfig({
  configPath = process.env.PIPELINE_GITHUB_APP_ENV_PATH ?? DEFAULT_CONFIG_PATH,
}: LoadGithubAppAuthConfigParams = {}): Promise<GithubAppAuthConfig | undefined> {
  const fileEnv = await readOptionalEnvFile(configPath);
  const appId = envValue(fileEnv, 'GITHUB_APP_ID');
  const installationId = envValue(fileEnv, 'GITHUB_APP_INSTALLATION_ID');
  const privateKeyPath = envValue(fileEnv, 'GITHUB_APP_PRIVATE_KEY_PATH');

  if (appId === undefined && installationId === undefined && privateKeyPath === undefined) return undefined;
  if (appId === undefined || installationId === undefined || privateKeyPath === undefined) {
    throw new Error(
      `Incomplete GitHub App auth config at ${configPath}; expected GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID, and GITHUB_APP_PRIVATE_KEY_PATH.`,
    );
  }

  return { appId, installationId, privateKeyPath };
}

function base64Url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

export interface CreateGithubAppJwtParams {
  appId: string;
  privateKey: string;
  nowMs?: number;
}

export function createGithubAppJwt({
  appId,
  privateKey,
  nowMs = Date.now(),
}: CreateGithubAppJwtParams): string {
  const nowSeconds = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 540,
      iss: appId,
    }),
  );
  const signingInput = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(signingInput).sign(privateKey);
  return `${signingInput}.${base64Url(signature)}`;
}

export interface FetchInstallationTokenParams {
  appId: string;
  installationId: string;
  privateKey: string;
  fetchImpl?: typeof fetch;
}

export async function fetchInstallationToken({
  appId,
  installationId,
  privateKey,
  fetchImpl = fetch,
}: FetchInstallationTokenParams): Promise<GithubAppInstallationToken> {
  const jwt = createGithubAppJwt({ appId, privateKey });
  const response = await fetchImpl(
    `https://api.github.com/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Accept': 'application/vnd.github+json',
        'Authorization': `Bearer ${jwt}`,
        'X-GitHub-Api-Version': GITHUB_API_VERSION,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `GitHub App installation token request failed (${response.status}): ${await response.text()}`,
    );
  }

  const body = (await response.json()) as { token?: unknown; expires_at?: unknown };
  if (typeof body.token !== 'string' || typeof body.expires_at !== 'string') {
    throw new Error('GitHub App installation token response was missing token or expires_at.');
  }

  return { token: body.token, expiresAt: body.expires_at };
}

export interface CreateGithubAppAuthEnvProviderParams {
  config: GithubAppAuthConfig;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
}

export function createGithubAppAuthEnvProvider({
  config,
  fetchImpl = fetch,
  nowMs = Date.now,
}: CreateGithubAppAuthEnvProviderParams): GithubAuthEnvProvider {
  let cachedToken: GithubAppInstallationToken | undefined;
  let privateKey: string | undefined;

  return async () => {
    privateKey ??= await readFile(config.privateKeyPath, 'utf8');
    const expiresMs = cachedToken === undefined ? 0 : Date.parse(cachedToken.expiresAt);
    if (cachedToken === undefined || expiresMs - TOKEN_REFRESH_SKEW_MS <= nowMs()) {
      cachedToken = await fetchInstallationToken({
        appId: config.appId,
        installationId: config.installationId,
        privateKey,
        fetchImpl,
      });
    }

    return { GH_TOKEN: cachedToken.token };
  };
}
