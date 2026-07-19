import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../../../src/sync/index.js';
import { createMemoryStorage, type StorageAdapter } from '../../../src/storage/index.js';
import { noopLogger } from '../../../src/logger/index.js';
import { createHooks } from '../../../src/hooks/index.js';
import { CalendarSdkError } from '../../../src/errors/index.js';
import type { Account } from '../../../src/types/account.js';
import type { Calendar } from '../../../src/types/calendar.js';
import type { CalendarEvent } from '../../../src/types/event.js';
import type { ProviderAdapter, TokenSet } from '../../../src/adapters/provider.js';
import type { SyncCursor, SyncResult } from '../../../src/types/sync.js';

function fakeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    provider: 'google',
    displayName: 'Test User',
    email: 'test@example.com',
    status: 'connected',
    capabilities: {
      calendars: {
        create: true,
        update: true,
        delete: true,
        share: true,
        manageNotifications: true,
      },
      events: {
        list: true,
        create: true,
        update: true,
        delete: true,
        move: true,
        duplicate: true,
        attachments: true,
        conferenceData: true,
      },
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

function fakeCalendar(overrides: Partial<Calendar> = {}): Calendar {
  return {
    id: 'cal-sdk-id',
    accountId: 'account-1',
    providerId: 'cal-provider-id',
    name: 'Primary',
    timezone: 'UTC',
    primary: true,
    readOnly: false,
    hidden: false,
    accessRole: 'owner',
    capabilities: {
      create: true,
      update: true,
      delete: true,
      share: true,
      manageNotifications: true,
    },
    raw: {},
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'evt-1',
    accountId: 'account-1',
    calendarId: 'cal-sdk-id',
    providerId: 'evt-provider-1',
    title: 'Event',
    start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
    end: { dateTime: '2026-08-01T11:00:00Z', timezone: 'UTC' },
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
    ...overrides,
  };
}

function fakeProvider(sync: Partial<ProviderAdapter['sync']>): ProviderAdapter {
  return {
    key: 'google',
    displayName: 'Fake Google',
    sync: {
      fullSync: vi.fn(),
      incrementalSync: vi.fn(),
      ...sync,
    },
  } as unknown as ProviderAdapter;
}

const TOKEN: TokenSet = { accessToken: 'real-access-token' };

describe('SyncService', () => {
  let storage: StorageAdapter;
  let getToken: ReturnType<typeof vi.fn>;
  let getProvider: ReturnType<typeof vi.fn>;
  let hooks: ReturnType<typeof createHooks>;
  let sync: SyncService;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.accounts.save(fakeAccount());
    getToken = vi.fn().mockResolvedValue(TOKEN);
    getProvider = vi.fn();
    hooks = createHooks();
    sync = new SyncService({ storage, logger: noopLogger, getToken, getProvider, hooks });
  });

  describe('fullSync', () => {
    it('throws NOT_FOUND when the account does not exist', async () => {
      await expect(sync.fullSync('missing-account')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('throws AUTH_REQUIRED when there is no valid token', async () => {
      getToken.mockResolvedValue(null);
      const provider = fakeProvider({});
      getProvider.mockReturnValue(provider);

      await expect(sync.fullSync('account-1')).rejects.toMatchObject({ code: 'AUTH_REQUIRED' });
    });

    it('passes the real token and the provider (not SDK) calendar id downstream', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      const fullSyncFn = vi.fn().mockResolvedValue({
        accountId: '',
        scope: 'events',
        events: [],
        deletions: [],
        expiredToken: false,
        hasMore: false,
      } as SyncResult);
      getProvider.mockReturnValue(fakeProvider({ fullSync: fullSyncFn }));

      await sync.fullSync('account-1', { calendarId: calendar.id });

      expect(fullSyncFn).toHaveBeenCalledWith(TOKEN, calendar.providerId, expect.any(Object));
    });

    it('persists created/updated events to storage and returns them in the result', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      const created = fakeEvent({ id: 'evt-new' });

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'created', event: created }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.fullSync('account-1', { calendarId: calendar.id });

      expect(result.events).toHaveLength(1);
      expect(await storage.events.get('evt-new')).toMatchObject({ id: 'evt-new' });
    });

    it('persists the returned cursor and includes it in the result', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      const cursorPayload: SyncCursor = {
        id: 'ignored',
        provider: 'google',
        accountId: '',
        scope: 'events',
        token: 'sync-token-abc',
        expiry: new Date(Date.now() + 3600_000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [],
            deletions: [],
            nextCursor: cursorPayload,
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.fullSync('account-1', { calendarId: calendar.id });

      expect(result.nextCursor?.token).toBe('sync-token-abc');
      const stored = await storage.syncCursors.get('account-1', 'events');
      expect(stored?.token).toBe('sync-token-abc');
    });

    it('syncs every stored calendar when no calendarId is given', async () => {
      const cal1 = fakeCalendar({ id: 'cal-1', providerId: 'provider-cal-1' });
      const cal2 = fakeCalendar({ id: 'cal-2', providerId: 'provider-cal-2' });
      await storage.calendars.save(cal1);
      await storage.calendars.save(cal2);

      const fullSyncFn = vi.fn().mockResolvedValue({
        accountId: '',
        scope: 'events',
        events: [],
        deletions: [],
        expiredToken: false,
        hasMore: false,
      } as SyncResult);
      getProvider.mockReturnValue(fakeProvider({ fullSync: fullSyncFn }));

      await sync.fullSync('account-1');

      const calledProviderIds = fullSyncFn.mock.calls.map((call) => call[1]);
      expect(calledProviderIds.sort()).toEqual(['provider-cal-1', 'provider-cal-2']);
    });

    it('emits sync/start then sync/end hooks with created/updated/deleted counts', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      const events: unknown[] = [];
      hooks.on('sync', (e) => {
        events.push(e);
      });

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'created', event: fakeEvent({ id: 'evt-new' }) }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      await sync.fullSync('account-1', { calendarId: calendar.id });

      expect(events).toEqual([
        expect.objectContaining({
          type: 'sync',
          event: 'start',
          provider: 'google',
          accountId: 'account-1',
        }),
        expect.objectContaining({ type: 'sync', event: 'end', created: 1, updated: 0, deleted: 0 }),
      ]);
    });

    it('emits a sync/end hook with the error when full sync fails', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      const events: unknown[] = [];
      hooks.on('sync', (e) => {
        events.push(e);
      });

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi
            .fn()
            .mockRejectedValue(
              new CalendarSdkError({ code: 'PROVIDER_ERROR', message: 'boom', provider: 'google' })
            ),
        })
      );

      await expect(sync.fullSync('account-1', { calendarId: calendar.id })).rejects.toMatchObject({
        code: 'PROVIDER_ERROR',
      });

      expect(events).toContainEqual(
        expect.objectContaining({
          type: 'sync',
          event: 'end',
          error: expect.objectContaining({ code: 'PROVIDER_ERROR' }),
        })
      );
    });
  });

  describe('incrementalSync', () => {
    const cursor: SyncCursor = {
      id: 'account-1:events',
      provider: 'google',
      accountId: 'account-1',
      scope: 'events',
      token: 'old-token',
      expiry: new Date(Date.now() + 3600_000),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    it('throws VALIDATION_FAILED when there is no calendar to sync', async () => {
      getProvider.mockReturnValue(fakeProvider({}));

      await expect(sync.incrementalSync('account-1', cursor)).rejects.toMatchObject({
        code: 'VALIDATION_FAILED',
      });
    });

    it('passes the real token and provider calendar id downstream', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      const incrementalSyncFn = vi.fn().mockResolvedValue({
        accountId: '',
        scope: 'events',
        events: [],
        deletions: [],
        expiredToken: false,
        hasMore: false,
      } as SyncResult);
      getProvider.mockReturnValue(fakeProvider({ incrementalSync: incrementalSyncFn }));

      await sync.incrementalSync('account-1', cursor, { calendarId: calendar.id });

      expect(incrementalSyncFn).toHaveBeenCalledWith(TOKEN, calendar.providerId, cursor);
    });

    it('applies created/updated/deleted changes to storage', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      // Real providers report deletions by their own (provider) id, not the SDK-local id -
      // the two are deliberately different here to exercise that translation.
      await storage.events.save(
        fakeEvent({ id: 'evt-to-delete', providerId: 'provider-evt-to-delete' })
      );

      getProvider.mockReturnValue(
        fakeProvider({
          incrementalSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [
              { type: 'created', event: fakeEvent({ id: 'evt-created' }) },
              { type: 'deleted', eventId: 'provider-evt-to-delete' },
            ],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.incrementalSync('account-1', cursor, { calendarId: calendar.id });

      expect(result.events).toHaveLength(2);
      expect(await storage.events.get('evt-created')).not.toBeNull();
      expect(await storage.events.get('evt-to-delete')).toBeNull();
    });

    it('ignores a reported deletion for a provider event id that was never synced locally', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      getProvider.mockReturnValue(
        fakeProvider({
          incrementalSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'deleted', eventId: 'never-synced-provider-id' }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      await expect(
        sync.incrementalSync('account-1', cursor, { calendarId: calendar.id })
      ).resolves.toMatchObject({ events: expect.any(Array) });
    });

    it('deletes the cursor and returns expiredToken without throwing when the provider reports expiry', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      await storage.syncCursors.save(cursor);

      getProvider.mockReturnValue(
        fakeProvider({
          incrementalSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [],
            deletions: [],
            expiredToken: true,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.incrementalSync('account-1', cursor, { calendarId: calendar.id });

      expect(result.expiredToken).toBe(true);
      expect(await storage.syncCursors.get('account-1', 'events')).toBeNull();
    });

    it('recovers gracefully when the provider throws SYNC_CURSOR_EXPIRED', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);
      await storage.syncCursors.save(cursor);

      getProvider.mockReturnValue(
        fakeProvider({
          incrementalSync: vi.fn().mockRejectedValue(
            new CalendarSdkError({
              code: 'SYNC_CURSOR_EXPIRED',
              message: 'expired',
              provider: 'google',
            })
          ),
        })
      );

      const result = await sync.incrementalSync('account-1', cursor, { calendarId: calendar.id });

      expect(result.expiredToken).toBe(true);
      expect(await storage.syncCursors.get('account-1', 'events')).toBeNull();
    });

    it('rethrows unrelated provider errors', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      getProvider.mockReturnValue(
        fakeProvider({
          incrementalSync: vi
            .fn()
            .mockRejectedValue(
              new CalendarSdkError({ code: 'PROVIDER_ERROR', message: 'boom', provider: 'google' })
            ),
        })
      );

      await expect(
        sync.incrementalSync('account-1', cursor, { calendarId: calendar.id })
      ).rejects.toMatchObject({ code: 'PROVIDER_ERROR' });
    });
  });

  describe('reconcile', () => {
    it('creates events present remotely but missing locally, and deletes local events missing remotely', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      const staleLocal = fakeEvent({ id: 'evt-stale', providerId: 'provider-stale' });
      await storage.events.save(staleLocal);

      const remoteOnly = fakeEvent({ id: 'evt-remote-only', providerId: 'provider-remote-only' });

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'created', event: remoteOnly }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.reconcile('account-1', 'events', { calendarId: calendar.id });

      expect(result.created).toBe(1);
      expect(result.deleted).toBe(1);
      expect(await storage.events.get('evt-remote-only')).not.toBeNull();
      expect(await storage.events.get('evt-stale')).toBeNull();
    });

    it('does not delete an event that still exists remotely, even when its local id differs from its providerId', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      // The SDK-local id and the provider id are deliberately different here - e.g. after
      // EventsService.move() reassigns a fresh local id while the vendor keeps its own.
      // Comparing the wrong id spaces would misclassify this still-live event as "missing
      // locally" and delete it.
      const stillLive = fakeEvent({
        id: 'sdk-local-id',
        providerId: 'vendor-event-id',
        title: 'Original',
      });
      await storage.events.save(stillLive);

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'updated', event: { ...stillLive, title: 'Updated' } }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.reconcile('account-1', 'events', { calendarId: calendar.id });

      expect(result.deleted).toBe(0);
      expect(result.updated).toBe(1);
      const stored = await storage.events.get('sdk-local-id');
      expect(stored).not.toBeNull();
      expect(stored?.title).toBe('Updated');
    });

    it('deletes a local event when the provider reports it deleted, resolving by providerId', async () => {
      const calendar = fakeCalendar();
      await storage.calendars.save(calendar);

      const local = fakeEvent({ id: 'sdk-local-id', providerId: 'vendor-event-id' });
      await storage.events.save(local);

      getProvider.mockReturnValue(
        fakeProvider({
          fullSync: vi.fn().mockResolvedValue({
            accountId: '',
            scope: 'events',
            events: [{ type: 'deleted', eventId: 'vendor-event-id' }],
            deletions: [],
            expiredToken: false,
            hasMore: false,
          } as SyncResult),
        })
      );

      const result = await sync.reconcile('account-1', 'events', { calendarId: calendar.id });

      expect(result.deleted).toBe(1);
      expect(await storage.events.get('sdk-local-id')).toBeNull();
    });
  });

  describe('getSyncStatus', () => {
    it('reports cursor expiry and last sync time', async () => {
      const expired: SyncCursor = {
        id: 'account-1:events',
        provider: 'google',
        accountId: 'account-1',
        scope: 'events',
        token: 't',
        expiry: new Date(Date.now() - 1000),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      await storage.syncCursors.save(expired);

      const status = await sync.getSyncStatus('account-1');

      expect(status.cursors).toHaveLength(1);
      expect(status.cursors[0].expired).toBe(true);
      expect(status.lastSync).toBeInstanceOf(Date);
    });
  });
});
