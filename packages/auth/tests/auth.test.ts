import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  createAuthFlow,
  createAuthorizationUrl,
  exchangeCodeForTokens,
  refreshToken,
  revokeToken,
  isTokenExpired,
  shouldRefreshToken,
  createTokenManager,
  createState,
  verifyState,
} from '../src/index.js';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(data)),
    json: () => Promise.resolve(data),
  };
}

describe('createAuthorizationUrl', () => {
  it('requests offline access and consent for Google so a refresh token is issued', () => {
    const url = createAuthorizationUrl({
      provider: 'google',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['https://www.googleapis.com/auth/calendar'],
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(parsed.searchParams.get('access_type')).toBe('offline');
    expect(parsed.searchParams.get('prompt')).toBe('consent');
  });

  it('does not request Google-specific params for Microsoft', () => {
    const url = createAuthorizationUrl({
      provider: 'microsoft',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['Calendars.ReadWrite'],
    });

    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(parsed.searchParams.has('access_type')).toBe(false);
    expect(parsed.searchParams.has('prompt')).toBe(false);
  });
});

describe('exchangeCodeForTokens', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  it('posts the authorization code and maps the response to a TokenSet', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      token_type: 'Bearer',
      scope: 'calendar offline_access',
    }));

    const tokens = await exchangeCodeForTokens({
      provider: 'google',
      code: 'auth-code',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example.com/callback',
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.scope).toEqual(['calendar', 'offline_access']);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('auth-code');
  });

  it('throws a descriptive error when the token endpoint rejects the code', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: () => Promise.resolve('invalid_grant'),
    });

    await expect(exchangeCodeForTokens({
      provider: 'google',
      code: 'bad-code',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
      fetch: fetchMock as unknown as typeof fetch,
    })).rejects.toThrow(/invalid_grant/);
  });
});

describe('refreshToken', () => {
  it('preserves the original refresh token when the provider does not return a new one', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      access_token: 'rotated-access',
      expires_in: 3600,
      token_type: 'Bearer',
    }));

    const tokens = await refreshToken(
      { provider: 'google', clientId: 'client-id', fetch: fetchMock as unknown as typeof fetch },
      { refreshToken: 'stable-refresh' }
    );

    expect(tokens.accessToken).toBe('rotated-access');
    expect(tokens.refreshToken).toBe('stable-refresh');
  });

  it('throws when the refresh is rejected', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 401, text: () => Promise.resolve('') });

    await expect(refreshToken(
      { provider: 'google', clientId: 'client-id', fetch: fetchMock as unknown as typeof fetch },
      { refreshToken: 'expired' }
    )).rejects.toThrow('Token refresh failed');
  });
});

describe('revokeToken', () => {
  it('calls the Google revoke endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, status: 200, text: () => Promise.resolve('') });

    await revokeToken('google', 'access-123', fetchMock as unknown as typeof fetch);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/revoke');
    expect(init.body).toContain('token=access-123');
  });

  it('is a no-op for Microsoft (no revocation endpoint)', async () => {
    const fetchMock = vi.fn();

    await revokeToken('microsoft', 'access-123', fetchMock as unknown as typeof fetch);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('createAuthFlow', () => {
  it('wires getAuthorizationUrl/exchangeCode/refreshToken/revokeToken to the same provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      access_token: 'access-1',
      refresh_token: 'refresh-1',
      expires_in: 3600,
      token_type: 'Bearer',
    }));

    const flow = createAuthFlow({
      provider: 'google',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'https://app.example.com/callback',
      scopes: ['https://www.googleapis.com/auth/calendar'],
      fetch: fetchMock as unknown as typeof fetch,
    });

    expect(flow.getAuthorizationUrl()).toContain('accounts.google.com');

    const tokens = await flow.exchangeCode('auth-code');
    expect(tokens.accessToken).toBe('access-1');
  });

  it('exposes refreshToken/revokeToken bound to the flow provider config', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({
      access_token: 'rotated',
      expires_in: 3600,
      token_type: 'Bearer',
    }));

    const flow = createAuthFlow({
      provider: 'google',
      clientId: 'client-id',
      redirectUri: 'https://app.example.com/callback',
      scopes: [],
      fetch: fetchMock as unknown as typeof fetch,
    });

    const tokens = await flow.refreshToken({ refreshToken: 'stable-refresh' });
    expect(tokens.accessToken).toBe('rotated');
    expect(tokens.refreshToken).toBe('stable-refresh');
  });
});

describe('isTokenExpired / shouldRefreshToken', () => {
  it('treats tokens without expiresAt as never expired', () => {
    expect(isTokenExpired({ accessToken: 'x' })).toBe(false);
    expect(shouldRefreshToken({ accessToken: 'x' })).toBe(false);
  });

  it('detects an expired token', () => {
    expect(isTokenExpired({ accessToken: 'x', expiresAt: new Date(Date.now() - 1000) })).toBe(true);
  });

  it('flags a token for refresh inside the buffer window before it actually expires', () => {
    const token = { accessToken: 'x', expiresAt: new Date(Date.now() + 30_000) };
    expect(isTokenExpired(token)).toBe(false);
    expect(shouldRefreshToken(token, 60_000)).toBe(true);
  });
});

describe('createTokenManager', () => {
  it('caches a token until it needs refreshing', async () => {
    const getRefreshToken = vi.fn().mockResolvedValue({ refreshToken: 'stable-refresh' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-1',
      expires_in: 3600,
      token_type: 'Bearer',
    }));

    const manager = createTokenManager({ provider: 'google', clientId: 'client-id', fetch: fetchMock as unknown as typeof fetch });

    const first = await manager.getToken('account-1', getRefreshToken);
    const second = await manager.getToken('account-1', getRefreshToken);

    expect(first?.accessToken).toBe('access-1');
    expect(second?.accessToken).toBe('access-1');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns null when there is no refresh token available', async () => {
    const manager = createTokenManager({ provider: 'google', clientId: 'client-id' });

    const token = await manager.getToken('account-1', async () => null);

    expect(token).toBeNull();
  });

  it('invalidateToken forces the next call to refresh again', async () => {
    const getRefreshToken = vi.fn().mockResolvedValue({ refreshToken: 'stable-refresh' });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({
      access_token: 'access-1',
      expires_in: 3600,
      token_type: 'Bearer',
    }));

    const manager = createTokenManager({ provider: 'google', clientId: 'client-id', fetch: fetchMock as unknown as typeof fetch });

    await manager.getToken('account-1', getRefreshToken);
    manager.invalidateToken('account-1');
    await manager.getToken('account-1', getRefreshToken);

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('createState / verifyState', () => {
  it('generates a random hex string of the expected length', () => {
    const state = createState();
    expect(state).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generates different values on each call', () => {
    expect(createState()).not.toBe(createState());
  });

  it('verifies a matching state', () => {
    const state = createState();
    expect(verifyState(state, state)).toBe(true);
  });

  it('rejects a mismatched state', () => {
    expect(verifyState(createState(), createState())).toBe(false);
  });

  it('rejects empty state values', () => {
    expect(verifyState('', 'anything')).toBe(false);
    expect(verifyState('anything', '')).toBe(false);
  });
});
