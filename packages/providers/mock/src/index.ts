import type {
  ProviderAdapter,
  TokenSet,
  RefreshToken,
  CreateAuthUrlOptions,
  CalendarsProviderMethods,
  EventsProviderMethods,
  AvailabilityProviderMethods,
  SyncProviderMethods,
  SubscriptionsProviderMethods,
  CalendarEvent,
  SyncEvent,
  Transport,
} from '@nandan-varma/calendar-sdk';
import { CalendarSdkError, toDate } from '@nandan-varma/calendar-sdk';
import { randomUUID } from 'node:crypto';

export interface MockProviderConfig {
  /** Fake connected-account identity returned by accounts.getAccount(). */
  account?: { id?: string; displayName?: string; email?: string };
  /** Seed one or more calendars so calendars.list() returns data immediately. Defaults to a single "Primary" calendar. */
  seedCalendars?: Array<{ id?: string; name: string; primary?: boolean; timezone?: string }>;
}

interface StoredCalendar {
  id: string;
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  primary: boolean;
}

type StoredEvent = Omit<CalendarEvent, 'accountId'>;

interface ChangeLogEntry {
  version: number;
  calendarId: string;
  change: SyncEvent;
}

/**
 * Fully in-memory ProviderAdapter - no network calls, deterministic, safe for unit tests
 * and examples. Every call operates on state held in this closure, so create a fresh
 * instance per test to avoid cross-test bleed.
 */
export function createMockProvider(config: MockProviderConfig = {}): ProviderAdapter {
  const calendars = new Map<string, StoredCalendar>();
  const events = new Map<string, StoredEvent>();
  const subscriptions = new Map<
    string,
    {
      id: string;
      resource: string;
      webhookUrl?: string;
      leaseExpiry: Date;
      status: 'active' | 'expired';
    }
  >();
  const changeLog: ChangeLogEntry[] = [];
  let version = 0;

  const seeds = config.seedCalendars ?? [{ name: 'Primary', primary: true }];
  for (const seed of seeds) {
    const id = seed.id ?? randomUUID();
    calendars.set(id, {
      id,
      name: seed.name,
      timezone: seed.timezone ?? 'UTC',
      primary: seed.primary ?? false,
    });
  }

  function recordChange(calendarId: string, change: SyncEvent) {
    version += 1;
    changeLog.push({ version, calendarId, change });
  }

  function requireCalendar(id: string): StoredCalendar {
    const calendar = calendars.get(id);
    if (!calendar) {
      throw new CalendarSdkError({
        code: 'NOT_FOUND',
        message: `Mock calendar not found: ${id}`,
        provider: 'mock',
      });
    }
    return calendar;
  }

  function requireEvent(id: string): StoredEvent {
    const event = events.get(id);
    if (!event) {
      throw new CalendarSdkError({ code: 'NOT_FOUND', message: `Mock event not found: ${id}` });
    }
    return event;
  }

  const auth: ProviderAdapter['auth'] = {
    createAuthorizationUrl: async (_options: CreateAuthUrlOptions) => 'mock://authorize',

    exchangeCode: async (_code: string, _redirectUri: string) => ({
      accessToken: `mock-access-${randomUUID()}`,
      refreshToken: `mock-refresh-${randomUUID()}`,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenType: 'Bearer',
    }),

    refreshToken: async (token: RefreshToken) => ({
      accessToken: `mock-access-${randomUUID()}`,
      refreshToken: token.refreshToken,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      tokenType: 'Bearer',
    }),

    revokeToken: async (_token: string) => {},
  };

  const accounts: ProviderAdapter['accounts'] = {
    getAccount: async (_token: TokenSet) => ({
      id: config.account?.id ?? 'mock-user',
      provider: 'mock' as const,
      displayName: config.account?.displayName ?? 'Mock User',
      email: config.account?.email ?? 'mock@example.com',
      status: 'connected' as const,
      capabilities: fullCapabilities(),
      raw: { mock: true },
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const calendarsApi: CalendarsProviderMethods = {
    list: async () => ({
      items: [...calendars.values()].map(toCalendar),
    }),

    get: async (_token, id) => toCalendar(requireCalendar(id)),

    create: async (_token, input) => {
      const id = randomUUID();
      const stored: StoredCalendar = {
        id,
        name: input.name,
        description: input.description,
        timezone: input.timezone ?? 'UTC',
        color: input.color,
        primary: input.primary ?? false,
      };
      calendars.set(id, stored);
      return toCalendar(stored);
    },

    update: async (_token, id, patch) => {
      const existing = requireCalendar(id);
      const updated: StoredCalendar = {
        ...existing,
        name: patch.name ?? existing.name,
        description: patch.description ?? existing.description,
        timezone: patch.timezone ?? existing.timezone,
        color: patch.color ?? existing.color,
      };
      calendars.set(id, updated);
      return toCalendar(updated);
    },

    delete: async (_token, id) => {
      calendars.delete(id);
      for (const [eventId, event] of events) {
        if (event.calendarId === id) events.delete(eventId);
      }
    },

    share: async (_token, calendarId, input) => {
      requireCalendar(calendarId);
      // Mock has no real ACL concept - sharing always succeeds against a known calendar.
      void input;
    },
  };

  const eventsApi: EventsProviderMethods = {
    list: async (_token, calendarId, query) => {
      requireCalendar(calendarId);
      let items = [...events.values()].filter((e) => e.calendarId === calendarId);

      if (query?.timeMin) {
        const min = query.timeMin;
        items = items.filter((e) => toDate(e.end) >= min);
      }
      if (query?.timeMax) {
        const max = query.timeMax;
        items = items.filter((e) => toDate(e.start) <= max);
      }

      return { items: items.map(toEvent) };
    },

    get: async (_token, calendarId, id) => {
      const event = requireEvent(id);
      if (event.calendarId !== calendarId) {
        throw new CalendarSdkError({
          code: 'NOT_FOUND',
          message: `Mock event not found in calendar ${calendarId}: ${id}`,
        });
      }
      return toEvent(event);
    },

    create: async (_token, calendarId, input) => {
      requireCalendar(calendarId);
      const id = randomUUID();
      const now = new Date();
      const stored: StoredEvent = {
        id,
        calendarId,
        providerId: id,
        title: input.title,
        description: input.description,
        location: input.location,
        start: input.start,
        end: input.end,
        allDay: input.allDay ?? false,
        timezone: input.timezone ?? 'UTC',
        status: input.status ?? 'confirmed',
        transparency: input.transparency ?? 'opaque',
        visibility: input.visibility ?? 'default',
        attendees: (input.attendees ?? []).map((a) => ({
          email: a.email,
          displayName: a.displayName,
          responseStatus: 'needsAction' as const,
        })),
        reminders: input.reminders,
        recurrence: input.recurrence,
        recurrenceMaster: !input.recurrence,
        exceptions: [],
        attachments: [],
        createdAt: now,
        updatedAt: now,
        raw: {},
        extensions: {},
      };
      events.set(id, stored);
      recordChange(calendarId, { type: 'created', event: toEvent(stored) });
      return toEvent(stored);
    },

    update: async (_token, calendarId, id, patch) => {
      const existing = requireEvent(id);
      const updated: StoredEvent = {
        ...existing,
        title: patch.title ?? existing.title,
        description: patch.description ?? existing.description,
        location: patch.location ?? existing.location,
        start: patch.start ?? existing.start,
        end: patch.end ?? existing.end,
        allDay: patch.allDay ?? existing.allDay,
        timezone: patch.timezone ?? existing.timezone,
        status: patch.status ?? existing.status,
        transparency: patch.transparency ?? existing.transparency,
        visibility: patch.visibility ?? existing.visibility,
        attendees: patch.attendees
          ? patch.attendees.map((a) => ({
              email: a.email,
              displayName: a.displayName,
              responseStatus: 'needsAction' as const,
            }))
          : existing.attendees,
        reminders: patch.reminders ?? existing.reminders,
        recurrence:
          patch.recurrence === null ? undefined : (patch.recurrence ?? existing.recurrence),
        updatedAt: new Date(),
      };
      events.set(id, updated);
      recordChange(calendarId, { type: 'updated', event: toEvent(updated) });
      return toEvent(updated);
    },

    delete: async (_token, calendarId, id) => {
      if (!events.has(id)) return;
      events.delete(id);
      recordChange(calendarId, { type: 'deleted', eventId: id });
    },

    move: async (_token, eventId, sourceCalendarId, targetCalendarId) => {
      const event = requireEvent(eventId);
      if (event.calendarId !== sourceCalendarId) {
        throw new CalendarSdkError({
          code: 'VALIDATION_FAILED',
          message: 'Event does not belong to the source calendar',
        });
      }
      requireCalendar(targetCalendarId);
      const moved: StoredEvent = { ...event, calendarId: targetCalendarId, updatedAt: new Date() };
      events.set(eventId, moved);
      recordChange(sourceCalendarId, { type: 'deleted', eventId });
      recordChange(targetCalendarId, { type: 'created', event: toEvent(moved) });
      return toEvent(moved);
    },

    duplicate: async (_token, eventId, targetCalendarId) => {
      const source = requireEvent(eventId);
      requireCalendar(targetCalendarId);
      const id = randomUUID();
      const now = new Date();
      const duplicated: StoredEvent = {
        ...source,
        id,
        providerId: id,
        calendarId: targetCalendarId,
        createdAt: now,
        updatedAt: now,
      };
      events.set(id, duplicated);
      recordChange(targetCalendarId, { type: 'created', event: toEvent(duplicated) });
      return toEvent(duplicated);
    },

    expandRecurrence: async (_token, calendarId, eventId, timeMin, timeMax) => {
      const event = requireEvent(eventId);
      if (event.calendarId !== calendarId || !event.recurrence) return [];
      // Minimal expansion: mock doesn't implement RRULE math, just echoes the master occurrence if it's in range.
      const start = toDate(event.start);
      if (start < timeMin || start > timeMax) return [];
      return [
        {
          id: `${eventId}-0`,
          eventId,
          title: event.title,
          start: event.start,
          end: event.end,
          allDay: event.allDay,
          status: event.status,
          location: event.location,
          recurrenceException: false,
        },
      ];
    },
  };

  const availabilityApi: AvailabilityProviderMethods = {
    freeBusy: async (_token, query) => {
      const result: Record<
        string,
        Array<{ start: Date; end: Date; status: 'free' | 'busy' | 'tentative' | 'unknown' }>
      > = {};

      for (const calendarId of query.calendars) {
        const busy = [...events.values()].filter(
          (e) =>
            e.calendarId === calendarId &&
            e.status !== 'cancelled' &&
            e.transparency !== 'transparent' &&
            toDate(e.end) >= query.timeMin &&
            toDate(e.start) <= query.timeMax
        );
        result[calendarId] = busy.map((e) => ({
          start: toDate(e.start),
          end: toDate(e.end),
          status: 'busy' as const,
        }));
      }

      return { calendars: result, timezone: query.timezone ?? 'UTC' };
    },

    suggestMeeting: async (_token, query) => ({
      meetingSuggestions: [
        {
          meetingTime: query.timeMin,
          confidence: 1,
          organizerAvailability: 'free',
          attendeeAvailability: Object.fromEntries(
            query.attendees.map((a) => [a, 'free' as const])
          ),
          meetingDuration: query.meetingDuration,
        },
      ],
    }),
  };

  const syncApi: SyncProviderMethods = {
    fullSync: async (_token, calendarId, options) => {
      requireCalendar(calendarId);
      let items = [...events.values()].filter((e) => e.calendarId === calendarId);
      if (options?.timeMin) items = items.filter((e) => toDate(e.end) >= options.timeMin!);
      if (options?.timeMax) items = items.filter((e) => toDate(e.start) <= options.timeMax!);

      return {
        accountId: '',
        scope: 'events',
        events: items.map((e) => ({ type: 'created' as const, event: toEvent(e) })),
        deletions: [],
        nextCursor: {
          id: randomUUID(),
          provider: 'mock',
          accountId: '',
          scope: 'events',
          token: String(version),
          expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        expiredToken: false,
        hasMore: false,
      };
    },

    incrementalSync: async (_token, calendarId, cursor) => {
      requireCalendar(calendarId);
      const since = Number(cursor.token) || 0;
      const changes = changeLog.filter(
        (entry) => entry.calendarId === calendarId && entry.version > since
      );

      return {
        accountId: '',
        scope: 'events',
        events: changes.map((entry) => entry.change),
        deletions: [],
        nextCursor: { ...cursor, token: String(version), updatedAt: new Date() },
        expiredToken: false,
        hasMore: false,
      };
    },
  };

  const subscriptionsApi: SubscriptionsProviderMethods = {
    create: async (_token, subConfig) => {
      const id = randomUUID();
      const leaseExpiry = new Date(Date.now() + (subConfig.leaseDurationSeconds ?? 3600) * 1000);
      subscriptions.set(id, {
        id,
        resource: subConfig.resource,
        webhookUrl: subConfig.webhookUrl,
        leaseExpiry,
        status: 'active',
      });
      return {
        id,
        accountId: '',
        provider: 'mock',
        resource: subConfig.resource,
        webhookUrl: subConfig.webhookUrl,
        leaseExpiry,
        secret: subConfig.secret,
        renewalPolicy: 'auto',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    renew: async (_token, subscriptionId) => {
      const sub = subscriptions.get(subscriptionId);
      if (!sub)
        throw new CalendarSdkError({
          code: 'NOT_FOUND',
          message: `Mock subscription not found: ${subscriptionId}`,
        });
      sub.leaseExpiry = new Date(Date.now() + 3600 * 1000);
      sub.status = 'active';
      return {
        id: sub.id,
        accountId: '',
        provider: 'mock',
        resource: sub.resource,
        webhookUrl: sub.webhookUrl,
        leaseExpiry: sub.leaseExpiry,
        renewalPolicy: 'auto',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    delete: async (_token, subscriptionId) => {
      subscriptions.delete(subscriptionId);
    },

    list: async () =>
      [...subscriptions.values()].map((sub) => ({
        id: sub.id,
        accountId: '',
        provider: 'mock',
        resource: sub.resource,
        webhookUrl: sub.webhookUrl,
        leaseExpiry: sub.leaseExpiry,
        renewalPolicy: 'auto' as const,
        status: sub.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      })),

    get: async (_token, subscriptionId) => {
      const sub = subscriptions.get(subscriptionId);
      if (!sub)
        throw new CalendarSdkError({
          code: 'NOT_FOUND',
          message: `Mock subscription not found: ${subscriptionId}`,
        });
      return {
        id: sub.id,
        accountId: '',
        provider: 'mock',
        resource: sub.resource,
        webhookUrl: sub.webhookUrl,
        leaseExpiry: sub.leaseExpiry,
        renewalPolicy: 'auto',
        status: sub.status,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };

  const noopTransport: Transport = {
    request: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'The mock provider has no real HTTP transport - it operates entirely in memory.',
      });
    },
  };

  return {
    key: 'mock',
    displayName: 'Mock Calendar (testing)',
    auth,
    accounts,
    calendars: calendarsApi,
    events: eventsApi,
    availability: availabilityApi,
    sync: syncApi,
    subscriptions: subscriptionsApi,
    getCapabilities: fullCapabilities,
    createTransport: () => noopTransport,
  };
}

function fullCapabilities() {
  return {
    calendars: { create: true, update: true, delete: true, share: true, manageNotifications: true },
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
  };
}

function toCalendar(stored: StoredCalendar) {
  return {
    id: stored.id,
    accountId: '',
    providerId: stored.id,
    name: stored.name,
    description: stored.description,
    timezone: stored.timezone,
    color: stored.color,
    primary: stored.primary,
    readOnly: false,
    hidden: false,
    accessRole: 'owner' as const,
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
  };
}

function toEvent(stored: StoredEvent): CalendarEvent {
  return { ...stored, accountId: '' };
}
