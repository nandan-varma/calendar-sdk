import type { Account } from '../types/account.js';
import type { Calendar, ListCalendarsQuery } from '../types/calendar.js';
import type { CalendarEvent, ListEventsQuery } from '../types/event.js';
import type { SyncCursor, SyncCursorInput } from '../types/sync.js';
import type { Subscription, SubscriptionInput } from '../types/subscription.js';

export interface StorageAdapter {
  accounts: AccountsStorage;
  calendars: CalendarsStorage;
  events: EventsStorage;
  syncCursors: SyncCursorsStorage;
  subscriptions: SubscriptionsStorage;
  tokens: TokensStorage;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

export interface AccountsStorage {
  save(account: Account): Promise<void>;
  get(id: string): Promise<Account | null>;
  list(): Promise<Account[]>;
  listByProvider(provider: string): Promise<Account[]>;
  update(id: string, data: Partial<Account>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface CalendarsStorage {
  save(calendar: Calendar): Promise<void>;
  get(id: string): Promise<Calendar | null>;
  list(accountId: string, query?: ListCalendarsQuery): Promise<Calendar[]>;
  listByAccount(accountId: string): Promise<Calendar[]>;
  update(id: string, data: Partial<Calendar>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface EventsStorage {
  save(event: CalendarEvent): Promise<void>;
  saveMany(events: CalendarEvent[]): Promise<void>;
  get(id: string): Promise<CalendarEvent | null>;
  list(calendarId: string, query?: ListEventsQuery): Promise<CalendarEvent[]>;
  listByAccount(accountId: string, query?: ListEventsQuery): Promise<CalendarEvent[]>;
  getByRecurringEventId(recurringEventId: string): Promise<CalendarEvent[]>;
  update(id: string, data: Partial<CalendarEvent>): Promise<void>;
  delete(id: string): Promise<void>;
  deleteByCalendar(calendarId: string): Promise<void>;
}

export interface SyncCursorsStorage {
  save(cursor: SyncCursor): Promise<void>;
  get(accountId: string, scope: string): Promise<SyncCursor | null>;
  list(accountId: string): Promise<SyncCursor[]>;
  delete(accountId: string, scope: string): Promise<void>;
  deleteByAccount(accountId: string): Promise<void>;
}

export interface SubscriptionsStorage {
  save(subscription: Subscription): Promise<void>;
  get(id: string): Promise<Subscription | null>;
  list(accountId: string): Promise<Subscription[]>;
  listByProvider(provider: string): Promise<Subscription[]>;
  update(id: string, data: Partial<Subscription>): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface EncryptedTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string[];
}

export interface TokensStorage {
  save(accountId: string, tokens: EncryptedTokens): Promise<void>;
  get(accountId: string): Promise<EncryptedTokens | null>;
  update(accountId: string, tokens: Partial<EncryptedTokens>): Promise<void>;
  delete(accountId: string): Promise<void>;
}

export interface MemoryStorageOptions {
  accountIdPrefix?: string;
  calendarIdPrefix?: string;
  eventIdPrefix?: string;
}

export function createMemoryStorage(_options?: MemoryStorageOptions): StorageAdapter {
  const accounts = new Map<string, Account>();
  const calendars = new Map<string, Calendar>();
  const events = new Map<string, CalendarEvent>();
  const syncCursors = new Map<string, SyncCursor>();
  const subscriptions = new Map<string, Subscription>();
  const tokens = new Map<string, EncryptedTokens>();

  return {
    accounts: {
      save: async (account) => { accounts.set(account.id, account); },
      get: async (id) => accounts.get(id) ?? null,
      list: async () => Array.from(accounts.values()),
      listByProvider: async (provider) => 
        Array.from(accounts.values()).filter(a => a.provider === provider),
      update: async (id, data) => {
        const existing = accounts.get(id);
        if (existing) accounts.set(id, { ...existing, ...data, updatedAt: new Date() });
      },
      delete: async (id) => { accounts.delete(id); },
    },
    calendars: {
      save: async (calendar) => { calendars.set(calendar.id, calendar); },
      get: async (id) => calendars.get(id) ?? null,
      list: async (accountId, query) => {
        let results = Array.from(calendars.values()).filter(c => c.accountId === accountId);
        if (query?.showHidden === false) {
          results = results.filter(c => !c.hidden);
        }
        if (query?.limit) results = results.slice(0, query.limit);
        return results;
      },
      listByAccount: async (accountId) => 
        Array.from(calendars.values()).filter(c => c.accountId === accountId),
      update: async (id, data) => {
        const existing = calendars.get(id);
        if (existing) calendars.set(id, { ...existing, ...data, updatedAt: new Date() });
      },
      delete: async (id) => { calendars.delete(id); },
    },
    events: {
      save: async (event) => { events.set(event.id, event); },
      saveMany: async (evts) => {
        for (const event of evts) {
          events.set(event.id, event);
        }
      },
      get: async (id) => events.get(id) ?? null,
      list: async (calendarId, query) => {
        let results = Array.from(events.values()).filter(e => e.calendarId === calendarId);
        if (query?.timeMin) {
          const min = query.timeMin.getTime();
          results = results.filter(e => {
            const endTime = e.end.dateTime ? new Date(e.end.dateTime).getTime() : 0;
            return endTime > min;
          });
        }
        if (query?.timeMax) {
          const max = query.timeMax.getTime();
          results = results.filter(e => {
            const startTime = e.start.dateTime ? new Date(e.start.dateTime).getTime() : 0;
            return startTime < max;
          });
        }
        if (query?.limit) results = results.slice(0, query.limit);
        if (query?.showDeleted === false) {
          results = results.filter(e => !e.deletedAt);
        }
        return results;
      },
      listByAccount: async (accountId) => 
        Array.from(events.values()).filter(e => e.accountId === accountId),
      getByRecurringEventId: async (recurringEventId) =>
        Array.from(events.values()).filter(e => e.recurringEventId === recurringEventId),
      update: async (id, data) => {
        const existing = events.get(id);
        if (existing) events.set(id, { ...existing, ...data, updatedAt: new Date() });
      },
      delete: async (id) => { events.delete(id); },
      deleteByCalendar: async (calendarId) => {
        const toDelete = Array.from(events.values())
          .filter(e => e.calendarId === calendarId)
          .map(e => e.id);
        for (const id of toDelete) {
          events.delete(id);
        }
      },
    },
    syncCursors: {
      save: async (cursor) => { syncCursors.set(`${cursor.accountId}:${cursor.scope}`, cursor); },
      get: async (accountId, scope) => syncCursors.get(`${accountId}:${scope}`) ?? null,
      list: async (accountId) => 
        Array.from(syncCursors.values()).filter(c => c.accountId === accountId),
      delete: async (accountId, scope) => { syncCursors.delete(`${accountId}:${scope}`); },
      deleteByAccount: async (accountId) => {
        const toDelete = Array.from(syncCursors.values())
          .filter(c => c.accountId === accountId)
          .map(c => `${c.accountId}:${c.scope}`);
        for (const key of toDelete) {
          syncCursors.delete(key);
        }
      },
    },
    subscriptions: {
      save: async (sub) => { subscriptions.set(sub.id, sub); },
      get: async (id) => subscriptions.get(id) ?? null,
      list: async (accountId) => 
        Array.from(subscriptions.values()).filter(s => s.accountId === accountId),
      listByProvider: async (provider) => 
        Array.from(subscriptions.values()).filter(s => s.provider === provider),
      update: async (id, data) => {
        const existing = subscriptions.get(id);
        if (existing) subscriptions.set(id, { ...existing, ...data, updatedAt: new Date() });
      },
      delete: async (id) => { subscriptions.delete(id); },
    },
    tokens: {
      save: async (accountId, tok) => { tokens.set(accountId, tok); },
      get: async (accountId) => tokens.get(accountId) ?? null,
      update: async (accountId, tok) => {
        const existing = tokens.get(accountId);
        if (existing) tokens.set(accountId, { ...existing, ...tok });
      },
      delete: async (accountId) => { tokens.delete(accountId); },
    },
    transaction: async <T>(fn: () => Promise<T>) => fn(),
  };
}

export function createPostgresStorage(_pool: unknown): StorageAdapter {
  throw new Error('PostgreSQL storage not implemented. Use createMemoryStorage() for development.');
}

export function createRedisStorage(_client: unknown): StorageAdapter {
  throw new Error('Redis storage not implemented. Use createMemoryStorage() for development.');
}
