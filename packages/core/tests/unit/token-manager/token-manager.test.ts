import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTokenManager } from '../../../src/token-manager.js';
import { createMemoryStorage, type StorageAdapter } from '../../../src/storage/index.js';
import { noopLogger } from '../../../src/logger/index.js';
import type { Account } from '../../../src/types/account.js';
import type { ProviderAdapter, TokenSet } from '../../../src/adapters/provider.js';
import type { ProviderKey } from '../../../src/types/common.js';

function fakeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    provider: 'google',
    displayName: 'Test User',
    email: 'test@example.com',
    status: 'connected',
    capabilities: {
      calendars: { create: true, update: true, delete: true, share: true, manageNotifications: true },
      events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: true },
    },
    raw: {},
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeProvider(refreshToken: (token: { refreshToken: string }) => Promise<TokenSet>): ProviderAdapter {
  return {
    key: 'google',
    displayName: 'Fake Google',
    auth: {
      createAuthorizationUrl: async () => '',
      exchangeCode: async () => ({ accessToken: 'x' }),
      refreshToken,
      revokeToken: async () => {},
    },
  } as unknown as ProviderAdapter;
}

describe('TokenManager', () => {
  let storage: StorageAdapter;
  let providers: Map<ProviderKey, ProviderAdapter>;

  beforeEach(() => {
    storage = createMemoryStorage();
    providers = new Map();
  });

  describe('getToken', () => {
    it('returns null when there is no stored token', async () => {
      await storage.accounts.save(fakeAccount());
      const manager = createTokenManager(storage, providers, noopLogger);

      expect(await manager.getToken('account-1')).toBeNull();
    });

    it('returns the stored token when it has not expired', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const manager = createTokenManager(storage, providers, noopLogger);
      const token = await manager.getToken('account-1');

      expect(token?.accessToken).toBe('valid-token');
    });

    it('serves subsequent reads from cache without hitting storage again', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'valid-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const manager = createTokenManager(storage, providers, noopLogger);
      await manager.getToken('account-1');

      const getSpy = vi.spyOn(storage.tokens, 'get');
      const token = await manager.getToken('account-1');

      expect(token?.accessToken).toBe('valid-token');
      expect(getSpy).not.toHaveBeenCalled();
    });

    it('refreshes automatically when the stored token is expired', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'stale-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      const refreshFn = vi.fn().mockResolvedValue({
        accessToken: 'fresh-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });
      providers.set('google', fakeProvider(refreshFn));

      const manager = createTokenManager(storage, providers, noopLogger);
      const token = await manager.getToken('account-1');

      expect(refreshFn).toHaveBeenCalledWith({ refreshToken: 'refresh-token' });
      expect(token?.accessToken).toBe('fresh-token');

      const persisted = await storage.tokens.get('account-1');
      expect(persisted?.accessToken).toBe('fresh-token');
    });

    it('marks the account expired and returns null when refresh fails', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'stale-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      providers.set('google', fakeProvider(vi.fn().mockRejectedValue(new Error('revoked'))));

      const manager = createTokenManager(storage, providers, noopLogger);
      const token = await manager.getToken('account-1');

      expect(token).toBeNull();
      const account = await storage.accounts.get('account-1');
      expect(account?.status).toBe('expired');
    });

    it('returns null without attempting refresh when there is no refresh token', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'stale-token',
        expiresAt: new Date(Date.now() - 1000),
      });

      const refreshFn = vi.fn();
      providers.set('google', fakeProvider(refreshFn));

      const manager = createTokenManager(storage, providers, noopLogger);
      const token = await manager.getToken('account-1');

      expect(token).toBeNull();
      expect(refreshFn).not.toHaveBeenCalled();
    });
  });

  describe('refresh', () => {
    it('forces a refresh even if the cached token has not expired', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'still-valid',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const refreshFn = vi.fn().mockResolvedValue({
        accessToken: 'rotated-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 120_000),
      });
      providers.set('google', fakeProvider(refreshFn));

      const manager = createTokenManager(storage, providers, noopLogger);
      await manager.getToken('account-1'); // populate cache with the "still valid" token
      const refreshed = await manager.refresh('account-1');

      expect(refreshFn).toHaveBeenCalledTimes(1);
      expect(refreshed.accessToken).toBe('rotated-token');
      expect((await manager.getToken('account-1'))?.accessToken).toBe('rotated-token');
    });

    it('throws AUTH_EXPIRED when there is no refresh token', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', { accessToken: 'x' });

      const manager = createTokenManager(storage, providers, noopLogger);

      await expect(manager.refresh('account-1')).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });
    });
  });

  describe('invalidate', () => {
    it('forces the next getToken to re-read from storage', async () => {
      await storage.accounts.save(fakeAccount());
      await storage.tokens.save('account-1', {
        accessToken: 'first',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });

      const manager = createTokenManager(storage, providers, noopLogger);
      await manager.getToken('account-1');

      await storage.tokens.save('account-1', {
        accessToken: 'second',
        refreshToken: 'refresh-token',
        expiresAt: new Date(Date.now() + 60_000),
      });
      manager.invalidate('account-1');

      const token = await manager.getToken('account-1');
      expect(token?.accessToken).toBe('second');
    });
  });
});
