import { describe, it, expect, vi } from 'vitest';
import { createCalendarSdk } from '../../../src/index.js';
import { createMemoryStorage } from '../../../src/storage/index.js';
import { noopLogger } from '../../../src/logger/index.js';
import type { ProviderAdapter, TokenSet } from '../../../src/adapters/provider.js';

function fakeMicrosoftProvider(overrides: {
  shareImpl?: ProviderAdapter['calendars']['share'];
  accessRole?: 'owner' | 'writer' | 'reader';
} = {}): ProviderAdapter {
  const calendar = {
    id: 'provider-cal-1',
    accountId: '',
    providerId: 'provider-cal-1',
    name: 'Primary',
    timezone: 'UTC',
    primary: true,
    readOnly: false,
    hidden: false,
    accessRole: overrides.accessRole ?? ('owner' as const),
    // Overwritten by CalendarsService.list() based on accessRole - the value here is unused.
    capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: false },
    raw: {},
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    key: 'microsoft',
    displayName: 'Fake Microsoft',
    auth: {
      createAuthorizationUrl: async () => '',
      exchangeCode: async () => ({ accessToken: 'access-token', refreshToken: 'refresh-token', expiresAt: new Date(Date.now() + 3600_000) }),
      refreshToken: async () => ({ accessToken: 'access-token' }),
      revokeToken: async () => {},
    },
    accounts: {
      getAccount: async (_token: TokenSet) => ({
        id: 'account-1',
        provider: 'microsoft' as const,
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
      list: async () => ({ items: [calendar] }),
      get: async () => calendar,
      create: async () => calendar,
      update: async () => calendar,
      delete: async () => {},
      ...(overrides.shareImpl ? { share: overrides.shareImpl } : {}),
    },
    events: {
      list: async () => ({ items: [] }),
      get: async () => { throw new Error('unused in these tests'); },
      create: async () => { throw new Error('unused in these tests'); },
      update: async () => { throw new Error('unused in these tests'); },
      delete: async () => {},
      move: async () => { throw new Error('unused in these tests'); },
      duplicate: async (_token, eventId, targetCalendarId) => ({
        id: 'duplicated-provider-id',
        accountId: '',
        calendarId: targetCalendarId,
        providerId: 'duplicated-provider-id',
        title: 'Duplicated',
        start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2026-08-01T10:30:00Z', timezone: 'UTC' },
        allDay: false,
        timezone: 'UTC',
        status: 'confirmed',
        transparency: 'opaque',
        visibility: 'default',
        attendees: [],
        recurrenceMaster: true,
        exceptions: [],
        attachments: [],
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
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
      create: async () => { throw new Error('unused in these tests'); },
      renew: async () => { throw new Error('unused in these tests'); },
      delete: async () => {},
      list: async () => [],
      get: async () => { throw new Error('unused in these tests'); },
    },
    getCapabilities: () => ({
      calendars: { create: true, update: true, delete: true, share: true, manageNotifications: false },
      events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: true },
    }),
    createTransport: () => ({ request: async () => { throw new Error('not used in these tests'); } }),
  };
}

async function connectedSdk(overrides?: Parameters<typeof fakeMicrosoftProvider>[0]) {
  const sdk = createCalendarSdk({
    providers: [fakeMicrosoftProvider(overrides)],
    storage: createMemoryStorage(),
    logger: noopLogger,
  });

  const account = await sdk.accounts.connect('microsoft', {
    authInput: { authorizationCode: 'unused' },
  });

  return { sdk, account };
}

describe('regression: errors no longer hardcode the "google" provider', () => {
  it('omits provider (does not claim "google") when the calendar is not yet known at all', async () => {
    const { sdk } = await connectedSdk();

    await expect(sdk.events.list('never-synced-calendar-id')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      provider: undefined,
    });
  });

  it('reports the real connected provider ("microsoft") once an account is resolved, never a hardcoded default', async () => {
    const { sdk } = await connectedSdk();

    await expect(sdk.accounts.connect('unregistered-provider', { authInput: { authorizationCode: 'x' } }))
      .rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED', provider: 'unregistered-provider' });
  });
});

describe('regression: calendars.share dispatches to the provider instead of silently no-oping', () => {
  it('calls provider.calendars.share with the calendar providerId and input', async () => {
    const shareImpl = vi.fn().mockResolvedValue(undefined);
    const { sdk, account } = await connectedSdk({ shareImpl });

    const [calendar] = await sdk.calendars.list(account.id);
    await sdk.calendars.share(calendar.id, { email: 'teammate@example.com', role: 'reader' });

    expect(shareImpl).toHaveBeenCalledWith(
      expect.objectContaining({ accessToken: 'access-token' }),
      'provider-cal-1',
      { email: 'teammate@example.com', role: 'reader' }
    );
  });

  it('throws CAPABILITY_UNSUPPORTED instead of silently no-oping when the provider has no share method', async () => {
    const { sdk, account } = await connectedSdk(); // no shareImpl -> provider.calendars.share is undefined

    const [calendar] = await sdk.calendars.list(account.id);

    await expect(
      sdk.calendars.share(calendar.id, { email: 'teammate@example.com', role: 'reader' })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
  });
});

describe('regression: events.duplicate forwards to the provider without needing local event fields', () => {
  it('persists the provider-returned duplicate under a fresh SDK id', async () => {
    const { sdk, account } = await connectedSdk();
    const [calendar] = await sdk.calendars.list(account.id);

    await sdk.storage.events.save({
      id: 'source-event-id',
      accountId: account.id,
      calendarId: calendar.id,
      providerId: 'source-provider-id',
      title: 'Original',
      start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2026-08-01T10:30:00Z', timezone: 'UTC' },
      allDay: false,
      timezone: 'UTC',
      status: 'confirmed',
      transparency: 'opaque',
      visibility: 'default',
      attendees: [],
      recurrenceMaster: true,
      exceptions: [],
      attachments: [],
      raw: {},
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const duplicated = await sdk.events.duplicate('source-event-id', calendar.id);

    expect(duplicated.title).toBe('Duplicated');
    expect(duplicated.calendarId).toBe(calendar.id);
    const stored = await sdk.storage.events.get(duplicated.id);
    expect(stored).not.toBeNull();
  });
});

describe('regression: per-calendar capabilities (accessRole) are enforced, not just the account-wide map', () => {
  it('rejects event creation/update/deletion on a calendar the account can only read', async () => {
    const { sdk, account } = await connectedSdk({ accessRole: 'reader' });
    const [calendar] = await sdk.calendars.list(account.id);
    expect(calendar.capabilities.create).toBe(false);

    await expect(
      sdk.events.create(calendar.id, {
        title: 'Nope',
        start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2026-08-01T10:30:00Z', timezone: 'UTC' },
      })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });

    await sdk.storage.events.save({
      id: 'existing-event',
      accountId: account.id,
      calendarId: calendar.id,
      providerId: 'existing-provider-event',
      title: 'Existing',
      start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2026-08-01T10:30:00Z', timezone: 'UTC' },
      allDay: false,
      timezone: 'UTC',
      status: 'confirmed',
      transparency: 'opaque',
      visibility: 'default',
      attendees: [],
      recurrenceMaster: true,
      exceptions: [],
      attachments: [],
      raw: {},
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await expect(sdk.events.update('existing-event', { title: 'Changed' })).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED',
    });
    await expect(sdk.events.delete('existing-event')).rejects.toMatchObject({
      code: 'CAPABILITY_UNSUPPORTED',
    });
  });

  it('rejects calendar update/delete/share on a calendar the account only has writer access to (not owner)', async () => {
    const shareImpl = vi.fn();
    const { sdk, account } = await connectedSdk({ accessRole: 'writer', shareImpl });
    const [calendar] = await sdk.calendars.list(account.id);
    expect(calendar.capabilities.update).toBe(true);
    expect(calendar.capabilities.delete).toBe(false);
    expect(calendar.capabilities.share).toBe(false);

    // Writer can update the calendar itself...
    await expect(sdk.calendars.update(calendar.id, { name: 'Renamed' })).resolves.toMatchObject({
      id: calendar.id,
    });

    // ...but only an owner can delete or share it, even though the account-wide capability map
    // (a provider-level flag) says the provider supports both operations.
    await expect(sdk.calendars.delete(calendar.id)).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    await expect(
      sdk.calendars.share(calendar.id, { email: 'teammate@example.com', role: 'reader' })
    ).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    expect(shareImpl).not.toHaveBeenCalled();
  });
});
