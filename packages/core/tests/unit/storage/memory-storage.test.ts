import { describe, it, expect, beforeEach } from 'vitest';
import { createMemoryStorage, type StorageAdapter } from '../../../src/storage/index.js';
import type { Account } from '../../../src/types/account.js';
import type { Calendar } from '../../../src/types/calendar.js';
import type { CalendarEvent } from '../../../src/types/event.js';

describe('MemoryStorage', () => {
  let storage: StorageAdapter;

  beforeEach(() => {
    storage = createMemoryStorage();
  });

  describe('Accounts', () => {
    const createTestAccount = (): Account => ({
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
    });

    it('should save and retrieve account', async () => {
      const account = createTestAccount();
      await storage.accounts.save(account);

      const retrieved = await storage.accounts.get('account-1');
      expect(retrieved).toBeDefined();
      expect(retrieved?.id).toBe('account-1');
      expect(retrieved?.email).toBe('test@example.com');
    });

    it('should return null for non-existent account', async () => {
      const retrieved = await storage.accounts.get('non-existent');
      expect(retrieved).toBeNull();
    });

    it('should list all accounts', async () => {
      const account1 = { ...createTestAccount(), id: 'account-1' };
      const account2 = { ...createTestAccount(), id: 'account-2', provider: 'microsoft' as const };

      await storage.accounts.save(account1);
      await storage.accounts.save(account2);

      const accounts = await storage.accounts.list();
      expect(accounts).toHaveLength(2);
    });

    it('should list accounts by provider', async () => {
      const googleAccount = { ...createTestAccount(), id: 'google-1', provider: 'google' as const };
      const microsoftAccount = {
        ...createTestAccount(),
        id: 'ms-1',
        provider: 'microsoft' as const,
      };

      await storage.accounts.save(googleAccount);
      await storage.accounts.save(microsoftAccount);

      const googleAccounts = await storage.accounts.listByProvider('google');
      expect(googleAccounts).toHaveLength(1);
      expect(googleAccounts[0].provider).toBe('google');
    });

    it('should update account', async () => {
      const account = createTestAccount();
      await storage.accounts.save(account);

      await storage.accounts.update('account-1', { displayName: 'Updated Name' });

      const updated = await storage.accounts.get('account-1');
      expect(updated?.displayName).toBe('Updated Name');
    });

    it('should delete account', async () => {
      const account = createTestAccount();
      await storage.accounts.save(account);

      await storage.accounts.delete('account-1');

      const retrieved = await storage.accounts.get('account-1');
      expect(retrieved).toBeNull();
    });
  });

  describe('Calendars', () => {
    const createTestCalendar = (accountId: string): Calendar => ({
      id: 'cal-1',
      accountId,
      providerId: 'provider-cal-1',
      name: 'Test Calendar',
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
    });

    it('should save and retrieve calendar', async () => {
      const calendar = createTestCalendar('account-1');
      await storage.calendars.save(calendar);

      const retrieved = await storage.calendars.get('cal-1');
      expect(retrieved?.name).toBe('Test Calendar');
    });

    it('should list calendars by account', async () => {
      const cal1 = { ...createTestCalendar('account-1'), id: 'cal-1' };
      const cal2 = { ...createTestCalendar('account-1'), id: 'cal-2' };
      const cal3 = { ...createTestCalendar('account-2'), id: 'cal-3' };

      await storage.calendars.save(cal1);
      await storage.calendars.save(cal2);
      await storage.calendars.save(cal3);

      const account1Cals = await storage.calendars.listByAccount('account-1');
      expect(account1Cals).toHaveLength(2);
    });

    it('should filter by showHidden', async () => {
      const hiddenCal = { ...createTestCalendar('account-1'), id: 'hidden-cal', hidden: true };
      const visibleCal = { ...createTestCalendar('account-1'), id: 'visible-cal', hidden: false };

      await storage.calendars.save(hiddenCal);
      await storage.calendars.save(visibleCal);

      const visible = await storage.calendars.list('account-1', { showHidden: false });
      expect(visible).toHaveLength(1);
      expect(visible[0].hidden).toBe(false);
    });

    it('should respect limit', async () => {
      const cal1 = { ...createTestCalendar('account-1'), id: 'cal-1' };
      const cal2 = { ...createTestCalendar('account-1'), id: 'cal-2' };

      await storage.calendars.save(cal1);
      await storage.calendars.save(cal2);

      const limited = await storage.calendars.list('account-1', { limit: 1 });
      expect(limited).toHaveLength(1);
    });
  });

  describe('Events', () => {
    const createTestEvent = (calendarId: string): CalendarEvent => ({
      id: 'event-1',
      accountId: 'account-1',
      calendarId,
      providerId: 'provider-event-1',
      title: 'Test Event',
      start: { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2024-01-15T11:00:00Z', timezone: 'UTC' },
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

    it('should save and retrieve event', async () => {
      const event = createTestEvent('cal-1');
      await storage.events.save(event);

      const retrieved = await storage.events.get('event-1');
      expect(retrieved?.title).toBe('Test Event');
    });

    it('should save many events', async () => {
      const events = [createTestEvent('cal-1'), { ...createTestEvent('cal-1'), id: 'event-2' }];

      await storage.events.saveMany(events);

      const list = await storage.events.list('cal-1');
      expect(list).toHaveLength(2);
    });

    it('should filter by time range', async () => {
      const event = createTestEvent('cal-1');
      await storage.events.save(event);

      const results = await storage.events.list('cal-1', {
        timeMin: new Date('2024-01-01'),
        timeMax: new Date('2024-01-31'),
      });

      expect(results).toHaveLength(1);
    });

    it('regression: an all-day (DateOnly) event survives a timeMin/timeMax filter', async () => {
      const allDayEvent: CalendarEvent = {
        ...createTestEvent('cal-1'),
        id: 'all-day-event',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' },
        allDay: true,
      };
      await storage.events.save(allDayEvent);

      const results = await storage.events.list('cal-1', {
        timeMin: new Date('2024-01-01'),
        timeMax: new Date('2024-01-31'),
      });

      expect(results.map((e) => e.id)).toEqual(['all-day-event']);
    });

    it('should filter out deleted when showDeleted=false', async () => {
      const event = createTestEvent('cal-1');
      await storage.events.save(event);

      await storage.events.delete('event-1');

      const active = await storage.events.list('cal-1', { showDeleted: false });
      expect(active).toHaveLength(0);
    });

    it('should delete events by calendar', async () => {
      const event1 = createTestEvent('cal-1');
      const event2 = { ...createTestEvent('cal-1'), id: 'event-2' };

      await storage.events.save(event1);
      await storage.events.save(event2);

      await storage.events.deleteByCalendar('cal-1');

      const remaining = await storage.events.list('cal-1');
      expect(remaining).toHaveLength(0);
    });

    it('regression: listByAccount respects the time-range query, not just listByAccount(accountId) with no filter', async () => {
      const inRange = createTestEvent('cal-1');
      const outOfRange = {
        ...createTestEvent('cal-1'),
        id: 'event-2',
        start: { dateTime: '2025-06-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2025-06-01T11:00:00Z', timezone: 'UTC' },
      };
      await storage.events.save(inRange);
      await storage.events.save(outOfRange);

      const results = await storage.events.listByAccount('account-1', {
        timeMin: new Date('2024-01-01'),
        timeMax: new Date('2024-01-31'),
      });

      expect(results.map((e) => e.id)).toEqual(['event-1']);
    });

    it('finds an event by its provider id, scoped to the calendar', async () => {
      const event = createTestEvent('cal-1');
      await storage.events.save(event);

      const found = await storage.events.getByProviderId('cal-1', 'provider-event-1');
      expect(found?.id).toBe('event-1');

      const wrongCalendar = await storage.events.getByProviderId('cal-2', 'provider-event-1');
      expect(wrongCalendar).toBeNull();

      const unknownProviderId = await storage.events.getByProviderId(
        'cal-1',
        'no-such-provider-id'
      );
      expect(unknownProviderId).toBeNull();
    });

    it('keeps indexes correct when an event moves to a different calendar via update()', async () => {
      const event = createTestEvent('cal-1');
      await storage.events.save(event);

      await storage.events.update('event-1', { calendarId: 'cal-2' });

      expect(await storage.events.list('cal-1')).toHaveLength(0);
      expect(await storage.events.list('cal-2')).toHaveLength(1);
    });
  });

  describe('Tokens', () => {
    it('should save and retrieve tokens', async () => {
      await storage.tokens.save('account-1', {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: new Date('2024-01-15T12:00:00Z'),
        tokenType: 'Bearer',
      });

      const tokens = await storage.tokens.get('account-1');
      expect(tokens?.accessToken).toBe('access-token');
      expect(tokens?.refreshToken).toBe('refresh-token');
    });

    it('should update tokens', async () => {
      await storage.tokens.save('account-1', {
        accessToken: 'old-token',
      });

      await storage.tokens.update('account-1', {
        accessToken: 'new-token',
      });

      const tokens = await storage.tokens.get('account-1');
      expect(tokens?.accessToken).toBe('new-token');
    });

    it('should delete tokens', async () => {
      await storage.tokens.save('account-1', {
        accessToken: 'token',
      });

      await storage.tokens.delete('account-1');

      const tokens = await storage.tokens.get('account-1');
      expect(tokens).toBeNull();
    });
  });

  describe('Transaction', () => {
    it('should execute transaction', async () => {
      const result = await storage.transaction(async () => {
        return 'success';
      });

      expect(result).toBe('success');
    });
  });
});
