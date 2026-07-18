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
  /**
   * Looks up an event by the provider's own id, scoped to a calendar (provider ids are only
   * unique within a calendar, not globally). Sync results only carry provider ids - this is
   * the only way to translate one back to the SDK-local id that storage keys everything else by.
   */
  getByProviderId(calendarId: string, providerId: string): Promise<CalendarEvent | null>;
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

function applyEventQuery(events: CalendarEvent[], query?: ListEventsQuery): CalendarEvent[] {
  let results = events;
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
  if (query?.showDeleted === false) {
    results = results.filter(e => !e.deletedAt);
  }
  if (query?.limit) results = results.slice(0, query.limit);
  return results;
}

// Secondary index: key -> set of ids. Keeps list-by-X operations O(matches) instead of an
// O(n) scan over the whole collection on every call.
class ByKeyIndex {
  private map = new Map<string, Set<string>>();

  add(key: string | undefined, id: string): void {
    if (key === undefined) return;
    let set = this.map.get(key);
    if (!set) {
      set = new Set();
      this.map.set(key, set);
    }
    set.add(id);
  }

  remove(key: string | undefined, id: string): void {
    if (key === undefined) return;
    const set = this.map.get(key);
    if (!set) return;
    set.delete(id);
    if (set.size === 0) this.map.delete(key);
  }

  rekey(oldKey: string | undefined, newKey: string | undefined, id: string): void {
    if (oldKey === newKey) return;
    this.remove(oldKey, id);
    this.add(newKey, id);
  }

  get(key: string): string[] {
    const set = this.map.get(key);
    return set ? Array.from(set) : [];
  }

  clear(key: string): void {
    this.map.delete(key);
  }
}

export function createMemoryStorage(_options?: MemoryStorageOptions): StorageAdapter {
  const accounts = new Map<string, Account>();
  const calendars = new Map<string, Calendar>();
  const events = new Map<string, CalendarEvent>();
  const syncCursors = new Map<string, SyncCursor>();
  const subscriptions = new Map<string, Subscription>();
  const tokens = new Map<string, EncryptedTokens>();

  const accountsByProvider = new ByKeyIndex();
  const calendarsByAccount = new ByKeyIndex();
  const eventsByCalendar = new ByKeyIndex();
  const eventsByAccount = new ByKeyIndex();
  const eventsByRecurringId = new ByKeyIndex();
  const eventsByProviderId = new Map<string, string>(); // `${calendarId}:${providerId}` -> event id
  const syncCursorsByAccount = new ByKeyIndex();
  const subscriptionsByAccount = new ByKeyIndex();
  const subscriptionsByProvider = new ByKeyIndex();

  const providerIdKey = (calendarId: string, providerId: string) => `${calendarId}:${providerId}`;

  function getMany<T>(store: Map<string, T>, ids: string[]): T[] {
    const results: T[] = [];
    for (const id of ids) {
      const value = store.get(id);
      if (value) results.push(value);
    }
    return results;
  }

  function indexEvent(event: CalendarEvent, previous?: CalendarEvent): void {
    eventsByCalendar.rekey(previous?.calendarId, event.calendarId, event.id);
    eventsByAccount.rekey(previous?.accountId, event.accountId, event.id);
    eventsByRecurringId.rekey(previous?.recurringEventId, event.recurringEventId, event.id);

    if (previous && (previous.calendarId !== event.calendarId || previous.providerId !== event.providerId)) {
      eventsByProviderId.delete(providerIdKey(previous.calendarId, previous.providerId));
    }
    eventsByProviderId.set(providerIdKey(event.calendarId, event.providerId), event.id);
  }

  function unindexEvent(event: CalendarEvent): void {
    eventsByCalendar.remove(event.calendarId, event.id);
    eventsByAccount.remove(event.accountId, event.id);
    eventsByRecurringId.remove(event.recurringEventId, event.id);
    eventsByProviderId.delete(providerIdKey(event.calendarId, event.providerId));
  }

  return {
    accounts: {
      save: async (account) => {
        const existing = accounts.get(account.id);
        accountsByProvider.rekey(existing?.provider, account.provider, account.id);
        accounts.set(account.id, account);
      },
      get: async (id) => accounts.get(id) ?? null,
      list: async () => Array.from(accounts.values()),
      listByProvider: async (provider) => getMany(accounts, accountsByProvider.get(provider)),
      update: async (id, data) => {
        const existing = accounts.get(id);
        if (!existing) return;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        accountsByProvider.rekey(existing.provider, updated.provider, id);
        accounts.set(id, updated);
      },
      delete: async (id) => {
        const existing = accounts.get(id);
        if (existing) accountsByProvider.remove(existing.provider, id);
        accounts.delete(id);
      },
    },
    calendars: {
      save: async (calendar) => {
        const existing = calendars.get(calendar.id);
        calendarsByAccount.rekey(existing?.accountId, calendar.accountId, calendar.id);
        calendars.set(calendar.id, calendar);
      },
      get: async (id) => calendars.get(id) ?? null,
      list: async (accountId, query) => {
        let results = getMany(calendars, calendarsByAccount.get(accountId));
        if (query?.showHidden === false) {
          results = results.filter(c => !c.hidden);
        }
        if (query?.limit) results = results.slice(0, query.limit);
        return results;
      },
      listByAccount: async (accountId) => getMany(calendars, calendarsByAccount.get(accountId)),
      update: async (id, data) => {
        const existing = calendars.get(id);
        if (!existing) return;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        calendarsByAccount.rekey(existing.accountId, updated.accountId, id);
        calendars.set(id, updated);
      },
      delete: async (id) => {
        const existing = calendars.get(id);
        if (existing) calendarsByAccount.remove(existing.accountId, id);
        calendars.delete(id);
      },
    },
    events: {
      save: async (event) => {
        indexEvent(event, events.get(event.id));
        events.set(event.id, event);
      },
      saveMany: async (evts) => {
        for (const event of evts) {
          indexEvent(event, events.get(event.id));
          events.set(event.id, event);
        }
      },
      get: async (id) => events.get(id) ?? null,
      getByProviderId: async (calendarId, providerId) => {
        const id = eventsByProviderId.get(providerIdKey(calendarId, providerId));
        return id ? (events.get(id) ?? null) : null;
      },
      list: async (calendarId, query) => applyEventQuery(getMany(events, eventsByCalendar.get(calendarId)), query),
      listByAccount: async (accountId, query) => applyEventQuery(getMany(events, eventsByAccount.get(accountId)), query),
      getByRecurringEventId: async (recurringEventId) => getMany(events, eventsByRecurringId.get(recurringEventId)),
      update: async (id, data) => {
        const existing = events.get(id);
        if (!existing) return;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        indexEvent(updated, existing);
        events.set(id, updated);
      },
      delete: async (id) => {
        const existing = events.get(id);
        if (existing) unindexEvent(existing);
        events.delete(id);
      },
      deleteByCalendar: async (calendarId) => {
        for (const id of eventsByCalendar.get(calendarId)) {
          const existing = events.get(id);
          if (existing) unindexEvent(existing);
          events.delete(id);
        }
      },
    },
    syncCursors: {
      save: async (cursor) => {
        const key = `${cursor.accountId}:${cursor.scope}`;
        if (!syncCursors.has(key)) {
          syncCursorsByAccount.add(cursor.accountId, key);
        }
        syncCursors.set(key, cursor);
      },
      get: async (accountId, scope) => syncCursors.get(`${accountId}:${scope}`) ?? null,
      list: async (accountId) => getMany(syncCursors, syncCursorsByAccount.get(accountId)),
      delete: async (accountId, scope) => {
        const key = `${accountId}:${scope}`;
        syncCursorsByAccount.remove(accountId, key);
        syncCursors.delete(key);
      },
      deleteByAccount: async (accountId) => {
        for (const key of syncCursorsByAccount.get(accountId)) {
          syncCursors.delete(key);
        }
        syncCursorsByAccount.clear(accountId);
      },
    },
    subscriptions: {
      save: async (sub) => {
        const existing = subscriptions.get(sub.id);
        subscriptionsByAccount.rekey(existing?.accountId, sub.accountId, sub.id);
        subscriptionsByProvider.rekey(existing?.provider, sub.provider, sub.id);
        subscriptions.set(sub.id, sub);
      },
      get: async (id) => subscriptions.get(id) ?? null,
      list: async (accountId) => getMany(subscriptions, subscriptionsByAccount.get(accountId)),
      listByProvider: async (provider) => getMany(subscriptions, subscriptionsByProvider.get(provider)),
      update: async (id, data) => {
        const existing = subscriptions.get(id);
        if (!existing) return;
        const updated = { ...existing, ...data, updatedAt: new Date() };
        subscriptionsByAccount.rekey(existing.accountId, updated.accountId, id);
        subscriptionsByProvider.rekey(existing.provider, updated.provider, id);
        subscriptions.set(id, updated);
      },
      delete: async (id) => {
        const existing = subscriptions.get(id);
        if (existing) {
          subscriptionsByAccount.remove(existing.accountId, id);
          subscriptionsByProvider.remove(existing.provider, id);
        }
        subscriptions.delete(id);
      },
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
