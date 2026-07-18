import { describe, it, expect, vi } from 'vitest';
import { createCalendarSdk } from '../../../src/index.js';
import { createMemoryStorage } from '../../../src/storage/index.js';
import { noopLogger } from '../../../src/logger/index.js';
import { createHooks } from '../../../src/hooks/index.js';
import type { ProviderAdapter, TokenSet } from '../../../src/adapters/provider.js';
import type { HookEvent } from '../../../src/hooks/index.js';

function fakeProvider(overrides: {
  refreshToken?: ProviderAdapter['auth']['refreshToken'];
  revokeToken?: ProviderAdapter['auth']['revokeToken'];
} = {}): ProviderAdapter {
  return {
    key: 'google',
    displayName: 'Fake Google',
    auth: {
      createAuthorizationUrl: async () => '',
      exchangeCode: async () => { throw new Error('unused in these tests'); },
      refreshToken: overrides.refreshToken ?? (async () => ({ accessToken: 'refreshed-token' })),
      revokeToken: overrides.revokeToken ?? (async () => {}),
    },
    accounts: {
      getAccount: async (_token: TokenSet) => ({
        id: 'account-1',
        provider: 'google' as const,
        displayName: 'Ada',
        email: 'ada@example.com',
        status: 'connected' as const,
        capabilities: {
          calendars: { create: true, update: true, delete: true, share: true, manageNotifications: false },
          events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
          sync: { incremental: true, webhook: true, polling: true },
          availability: { freeBusy: true, suggestedTimes: true },
        },
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    },
    calendars: {
      list: async () => ({ items: [] }),
      get: async () => { throw new Error('unused'); },
      create: async () => { throw new Error('unused'); },
      update: async () => { throw new Error('unused'); },
      delete: async () => {},
    },
    events: {
      list: async () => ({ items: [] }),
      get: async () => { throw new Error('unused'); },
      create: async () => { throw new Error('unused'); },
      update: async () => { throw new Error('unused'); },
      delete: async () => {},
      move: async () => { throw new Error('unused'); },
      duplicate: async () => { throw new Error('unused'); },
      expandRecurrence: async () => [],
    },
    availability: {
      freeBusy: async () => ({ calendars: {} }),
      suggestMeeting: async () => ({ meetingSuggestions: [] }),
    },
    sync: {
      fullSync: async () => ({ accountId: '', scope: 'events', events: [], deletions: [], expiredToken: false, hasMore: false }),
      incrementalSync: async () => ({ accountId: '', scope: 'events', events: [], deletions: [], expiredToken: false, hasMore: false }),
    },
    subscriptions: {
      create: async () => { throw new Error('unused'); },
      renew: async () => { throw new Error('unused'); },
      delete: async () => {},
      list: async () => [],
      get: async () => { throw new Error('unused'); },
    },
    getCapabilities: () => ({
      calendars: { create: true, update: true, delete: true, share: true, manageNotifications: false },
      events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: true },
    }),
    createTransport: () => ({ request: async () => { throw new Error('unused'); } }),
  };
}

describe('AccountsService.connect - AuthInput.expiresAt', () => {
  it('honors a caller-supplied expiresAt instead of guessing a 1-hour lifetime', async () => {
    const sdk = createCalendarSdk({
      providers: [fakeProvider()],
      storage: createMemoryStorage(),
      logger: noopLogger,
    });

    const realExpiry = new Date(Date.now() + 10 * 60_000); // 10 minutes, not the guessed 1 hour
    await sdk.accounts.connect('google', {
      authInput: { accessToken: 'token', refreshToken: 'refresh', expiresAt: realExpiry },
    });

    const account = (await sdk.accounts.list())[0];
    const stored = await sdk.storage.tokens.get(account.id);
    expect(stored?.expiresAt?.getTime()).toBe(realExpiry.getTime());
  });

  it('falls back to a guessed 1-hour expiry when no expiresAt is given and a refresh token exists', async () => {
    const sdk = createCalendarSdk({
      providers: [fakeProvider()],
      storage: createMemoryStorage(),
      logger: noopLogger,
    });

    const before = Date.now();
    await sdk.accounts.connect('google', {
      authInput: { accessToken: 'token', refreshToken: 'refresh' },
    });

    const account = (await sdk.accounts.list())[0];
    const stored = await sdk.storage.tokens.get(account.id);
    expect(stored?.expiresAt?.getTime()).toBeGreaterThan(before + 59 * 60_000);
    expect(stored?.expiresAt?.getTime()).toBeLessThanOrEqual(before + 61 * 60_000);
  });
});

describe('AccountsService - hook emission', () => {
  it('emits auth/connected on a successful connect', async () => {
    const hooks = createHooks();
    const onAuth = vi.fn();
    hooks.on('auth', onAuth);

    const sdk = createCalendarSdk({
      providers: [fakeProvider()],
      storage: createMemoryStorage(),
      logger: noopLogger,
      hooks,
    });

    await sdk.accounts.connect('google', { authInput: { accessToken: 'token' } });

    expect(onAuth).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth', event: 'connected', provider: 'google' })
    );
  });

  it('emits auth/error when connect fails', async () => {
    const hooks = createHooks();
    const events: HookEvent[] = [];
    hooks.on('auth', (e) => { events.push(e); });

    const sdk = createCalendarSdk({
      providers: [fakeProvider()],
      storage: createMemoryStorage(),
      logger: noopLogger,
      hooks,
    });

    await expect(sdk.accounts.connect('google', { authInput: {} })).rejects.toMatchObject({
      code: 'VALIDATION_FAILED',
    });

    expect(events).toContainEqual(expect.objectContaining({ type: 'auth', event: 'error', provider: 'google' }));
  });

  it('emits auth/refreshed on a successful refresh, and auth/expired when refresh fails', async () => {
    const hooks = createHooks();
    const events: HookEvent[] = [];
    hooks.on('auth', (e) => { events.push(e); });

    const sdk = createCalendarSdk({
      providers: [fakeProvider({ refreshToken: async () => { throw new Error('provider rejected refresh'); } })],
      storage: createMemoryStorage(),
      logger: noopLogger,
      hooks,
    });

    await sdk.accounts.connect('google', { authInput: { accessToken: 'token', refreshToken: 'refresh' } });
    const account = (await sdk.accounts.list())[0];

    await expect(sdk.accounts.refresh(account.id)).rejects.toMatchObject({ code: 'AUTH_EXPIRED' });

    expect(events).toContainEqual(expect.objectContaining({ type: 'auth', event: 'expired', accountId: account.id }));
  });

  it('emits auth/revoked on disconnect', async () => {
    const hooks = createHooks();
    const onAuth = vi.fn();
    hooks.on('auth', onAuth);

    const sdk = createCalendarSdk({
      providers: [fakeProvider()],
      storage: createMemoryStorage(),
      logger: noopLogger,
      hooks,
    });

    await sdk.accounts.connect('google', { authInput: { accessToken: 'token', refreshToken: 'refresh' } });
    const account = (await sdk.accounts.list())[0];
    onAuth.mockClear();

    await sdk.accounts.disconnect(account.id);

    expect(onAuth).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'auth', event: 'revoked', accountId: account.id })
    );
  });
});
