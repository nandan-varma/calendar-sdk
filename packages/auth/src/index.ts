import type { TokenSet, RefreshToken } from '@nandan-varma/calendar-sdk';

export interface AuthSession {
  accountId: string;
  provider: 'google' | 'microsoft' | 'caldav';
  tokens: EncryptedTokenSet;
  createdAt: Date;
  expiresAt?: Date;
  refreshAt?: Date;
}

export interface EncryptedTokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string[];
}

export interface TokenEncryptor {
  encrypt(tokens: TokenSet): Promise<EncryptedTokenSet>;
  decrypt(encrypted: EncryptedTokenSet): Promise<TokenSet>;
}

export interface AuthFlowOptions {
  provider: 'google' | 'microsoft';
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
  /** Bring your own fetch (proxying, instrumentation, test doubles, ...). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export interface AuthFlowResult {
  tokens: TokenSet;
  accountId: string;
}

export interface RefreshOptions {
  provider: 'google' | 'microsoft';
  clientId: string;
  clientSecret?: string;
  /** Bring your own fetch (proxying, instrumentation, test doubles, ...). Defaults to global fetch. */
  fetch?: typeof fetch;
}

export function createAuthFlow(options: AuthFlowOptions): AuthFlow {
  const authUrl = createAuthorizationUrl(options);

  return {
    getAuthorizationUrl: () => authUrl,
    async exchangeCode(code: string): Promise<TokenSet> {
      return exchangeCodeForTokens({
        provider: options.provider,
        code,
        clientId: options.clientId,
        clientSecret: options.clientSecret,
        redirectUri: options.redirectUri,
        fetch: options.fetch,
      });
    },
    async refreshToken(token: RefreshToken): Promise<TokenSet> {
      return refreshToken(
        {
          provider: options.provider,
          clientId: options.clientId,
          clientSecret: options.clientSecret,
          fetch: options.fetch,
        },
        token
      );
    },
    async revokeToken(accessToken: string): Promise<void> {
      return revokeToken(options.provider, accessToken, options.fetch);
    },
  };
}

export function createAuthorizationUrl(options: AuthFlowOptions): string {
  const params = new URLSearchParams({
    client_id: options.clientId,
    redirect_uri: options.redirectUri,
    response_type: 'code',
    scope: options.scopes.join(' '),
    ...(options.provider === 'google' && { access_type: 'offline', prompt: 'consent' }),
  });

  const baseUrl =
    options.provider === 'google'
      ? 'https://accounts.google.com/o/oauth2/v2/auth'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';

  return `${baseUrl}?${params}`;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope?: string;
}

export async function exchangeCodeForTokens(options: {
  provider: 'google' | 'microsoft';
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  fetch?: typeof fetch;
}): Promise<TokenSet> {
  const params = new URLSearchParams({
    code: options.code,
    client_id: options.clientId,
    client_secret: options.clientSecret || '',
    redirect_uri: options.redirectUri,
    grant_type: 'authorization_code',
  });

  const tokenUrl =
    options.provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = (await response.json()) as OAuthTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

export async function refreshToken(
  options: RefreshOptions,
  token: RefreshToken
): Promise<TokenSet> {
  const params = new URLSearchParams({
    refresh_token: token.refreshToken,
    client_id: options.clientId,
    client_secret: options.clientSecret || '',
    grant_type: 'refresh_token',
  });

  const tokenUrl =
    options.provider === 'google'
      ? 'https://oauth2.googleapis.com/token'
      : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';

  const fetchImpl = options.fetch ?? fetch;
  const response = await fetchImpl(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  if (!response.ok) {
    throw new Error('Token refresh failed');
  }

  const data = (await response.json()) as OAuthTokenResponse;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

export async function revokeToken(
  provider: 'google' | 'microsoft',
  accessToken: string,
  fetchImpl: typeof fetch = fetch
): Promise<void> {
  if (provider === 'google') {
    await fetchImpl('https://oauth2.googleapis.com/revoke', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `token=${encodeURIComponent(accessToken)}`,
    });
  }
}

export function isTokenExpired(token: TokenSet): boolean {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt.getTime();
}

export function shouldRefreshToken(token: TokenSet, bufferMs = 60000): boolean {
  if (!token.expiresAt) return false;
  return Date.now() >= token.expiresAt.getTime() - bufferMs;
}

class InternalTokenManager {
  private options: RefreshOptions;
  private cache = new Map<string, { token: TokenSet; refreshAt: Date }>();

  constructor(options: RefreshOptions) {
    this.options = options;
  }

  async getToken(
    accountId: string,
    getRefreshToken: () => Promise<RefreshToken | null>
  ): Promise<TokenSet | null> {
    const cached = this.cache.get(accountId);

    if (cached && !shouldRefreshToken(cached.token)) {
      return cached.token;
    }

    const refreshTokenValue = await getRefreshToken();
    if (!refreshTokenValue) return null;

    try {
      const newToken = await refreshToken(this.options, refreshTokenValue);
      this.cache.set(accountId, { token: newToken, refreshAt: new Date() });
      return newToken;
    } catch (error) {
      this.cache.delete(accountId);
      throw error;
    }
  }

  invalidateToken(accountId: string): void {
    this.cache.delete(accountId);
  }

  clear(): void {
    this.cache.clear();
  }
}

export function createTokenManager(options: RefreshOptions): TokenManagerHandle {
  return new InternalTokenManager(options);
}

export interface TokenManagerHandle {
  getToken(
    accountId: string,
    getRefreshToken: () => Promise<RefreshToken | null>
  ): Promise<TokenSet | null>;
  invalidateToken(accountId: string): void;
  clear(): void;
}

export interface AuthFlow {
  getAuthorizationUrl(): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refreshToken(token: RefreshToken): Promise<TokenSet>;
  revokeToken(accessToken: string): Promise<void>;
}

export function createState(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function verifyState(state: string, storedState: string): boolean {
  if (!state || !storedState) return false;
  return timingSafeEqual(state, storedState);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
