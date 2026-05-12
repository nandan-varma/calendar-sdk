import type { 
  ProviderAdapter, 
  TokenSet, 
  RefreshToken,
  CreateAuthUrlOptions,
  CapabilityMap,
} from '@calendar-sdk/core';

export interface MockProviderConfig {
  key?: 'google' | 'microsoft' | 'caldav';
  displayName?: string;
  capabilities?: Partial<CapabilityMap>;
  shouldFail?: boolean;
  failOnCall?: string[];
}

export function createMockProvider(config: MockProviderConfig = {}): ProviderAdapter {
  const {
    key = 'google',
    displayName = 'Mock Provider',
    capabilities = {},
    shouldFail = false,
    failOnCall = [],
  } = config;

  const fail = (method: string) => {
    if (shouldFail || failOnCall.includes(method)) {
      throw new Error(`Mock error: ${method} failed`);
    }
  };

  const defaultCapabilities: CapabilityMap = {
    calendars: { create: true, update: true, delete: true, share: true, manageNotifications: true },
    events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
    sync: { incremental: true, webhook: true, polling: true },
    availability: { freeBusy: true, suggestedTimes: true },
  };

  return {
    key,
    displayName,
    auth: {
      createAuthorizationUrl: async (_options: CreateAuthUrlOptions) => 'https://mock.auth/url',
      exchangeCode: async (_code: string, _redirectUri: string) => {
        fail('exchangeCode');
        return { accessToken: 'mock-access-token', refreshToken: 'mock-refresh-token', expiresAt: new Date() };
      },
      refreshToken: async (_token: RefreshToken) => {
        fail('refreshToken');
        return { accessToken: 'mock-refreshed-token', refreshToken: 'mock-refresh-token', expiresAt: new Date() };
      },
      revokeToken: async (_token: string) => { fail('revokeToken'); },
    },
    accounts: {
      getAccount: async (_token: TokenSet) => {
        fail('getAccount');
        return {
          id: 'mock-account-id',
          provider: key,
          displayName: 'Mock User',
          email: 'mock@example.com',
          status: 'connected',
          capabilities: mergeCapabilities(defaultCapabilities, capabilities),
          raw: { mock: true },
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
    },
    calendars: {
      list: async (_token: TokenSet, _query?: any) => {
        fail('listCalendars');
        return {
          items: [{
            id: 'mock-calendar-1',
            accountId: 'mock-account-id',
            providerId: 'mock-calendar-1',
            name: 'Mock Calendar',
            timezone: 'UTC',
            primary: true,
            readOnly: false,
            hidden: false,
            accessRole: 'owner',
            capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
            raw: {},
            extensions: {},
            createdAt: new Date(),
            updatedAt: new Date(),
          }],
        };
      },
      get: async (_token: TokenSet, id: string) => {
        fail('getCalendar');
        return {
          id,
          accountId: 'mock-account-id',
          providerId: id,
          name: 'Mock Calendar',
          timezone: 'UTC',
          primary: true,
          readOnly: false,
          hidden: false,
          accessRole: 'owner',
          capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
          raw: {},
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      create: async (_token: TokenSet, input: any) => {
        fail('createCalendar');
        return {
          id: 'mock-new-calendar',
          accountId: 'mock-account-id',
          providerId: 'mock-new-calendar',
          name: input.name,
          timezone: 'UTC',
          primary: false,
          readOnly: false,
          hidden: false,
          accessRole: 'owner',
          capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
          raw: {},
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      update: async (_token: TokenSet, id: string, patch: any) => {
        fail('updateCalendar');
        return {
          id,
          accountId: 'mock-account-id',
          providerId: id,
          name: patch.name || 'Mock Calendar',
          timezone: 'UTC',
          primary: true,
          readOnly: false,
          hidden: false,
          accessRole: 'owner',
          capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
          raw: {},
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      delete: async (_token: TokenSet, _id: string) => { fail('deleteCalendar'); },
    },
    events: {
      list: async (_token: TokenSet, _calendarId: string, _query?: any) => {
        fail('listEvents');
        return { items: [] };
      },
      get: async (_token: TokenSet, _calendarId: string, id: string) => {
        fail('getEvent');
        return createMockEvent(id, 'mock-calendar-1');
      },
      create: async (_token: TokenSet, _calendarId: string, input: any) => {
        fail('createEvent');
        return createMockEvent('mock-new-event', 'mock-calendar-1', input);
      },
      update: async (_token: TokenSet, _calendarId: string, id: string, patch: any) => {
        fail('updateEvent');
        return createMockEvent(id, 'mock-calendar-1', patch);
      },
      delete: async (_token: TokenSet, _calendarId: string, _id: string) => { fail('deleteEvent'); },
      move: async (_token: TokenSet, eventId: string, _sourceId: string, targetId: string) => {
        fail('moveEvent');
        return createMockEvent(eventId, targetId);
      },
      duplicate: async (_token: TokenSet, _eventId: string, targetCalendarId: string) => {
        fail('duplicateEvent');
        return createMockEvent('mock-duplicated-event', targetCalendarId);
      },
      expandRecurrence: async (_token: TokenSet, _calendarId: string, _eventId: string, _timeMin: Date, _timeMax: Date) => {
        fail('expandRecurrence');
        return [];
      },
    },
    availability: {
      freeBusy: async (_token: TokenSet, query: any) => {
        fail('freeBusy');
        return { calendars: query.calendars.reduce((acc: any, id: string) => ({ ...acc, [id]: [] }), {}) };
      },
      suggestMeeting: async (_token: TokenSet, query: any) => {
        fail('suggestMeeting');
        return { meetingSuggestions: [] };
      },
    },
    sync: {
      fullSync: async (_token: TokenSet, calendarId: string, _options?: any) => {
        fail('fullSync');
        return {
          events: [],
          deletions: [],
          expiredToken: false,
          hasMore: false,
        };
      },
      incrementalSync: async (_token: TokenSet, _calendarId: string, _cursor: any) => {
        fail('incrementalSync');
        return { events: [], deletions: [], expiredToken: false, hasMore: false };
      },
    },
    subscriptions: {
      create: async (_token: TokenSet, config: any) => {
        fail('createSubscription');
        return {
          id: 'mock-subscription',
          accountId: 'mock-account-id',
          provider: key,
          resource: config.resource,
          leaseExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          renewalPolicy: 'auto',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      renew: async (_token: TokenSet, subscriptionId: string) => {
        fail('renewSubscription');
        return {
          id: subscriptionId,
          accountId: 'mock-account-id',
          provider: key,
          resource: '',
          leaseExpiry: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          renewalPolicy: 'auto',
          status: 'active',
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      delete: async (_token: TokenSet, _subscriptionId: string) => { fail('deleteSubscription'); },
      list: async () => [],
      get: async (_token: TokenSet, _subscriptionId: string) => { throw new Error('Not implemented'); },
    },
    getCapabilities: () => mergeCapabilities(defaultCapabilities, capabilities),
    createTransport: () => ({
      request: async <T>(_options: any) => ({ data: {} as T, status: 200, headers: {} }),
    }),
  };
}

function createMockEvent(id: string, calendarId: string, input?: any): any {
  return {
    id,
    accountId: 'mock-account-id',
    calendarId,
    providerId: id,
    title: input?.title || 'Mock Event',
    description: input?.description,
    location: input?.location,
    start: input?.start || { dateTime: '2024-01-01T10:00:00Z', timezone: 'UTC' },
    end: input?.end || { dateTime: '2024-01-01T11:00:00Z', timezone: 'UTC' },
    allDay: false,
    timezone: 'UTC',
    status: 'confirmed' as const,
    transparency: 'opaque' as const,
    visibility: 'default' as const,
    attendees: [],
    reminders: undefined,
    recurrence: undefined,
    recurrenceMaster: true,
    exceptions: [],
    conference: undefined,
    attachments: [],
    raw: { mock: true },
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mergeCapabilities(base: CapabilityMap, override: Partial<CapabilityMap>): CapabilityMap {
  return {
    calendars: { ...base.calendars, ...override.calendars },
    events: { ...base.events, ...override.events },
    sync: { ...base.sync, ...override.sync },
    availability: { ...base.availability, ...override.availability },
  };
}

export interface MockFixtures {
  google: {
    calendar: any;
    event: any;
    account: any;
  };
  microsoft: {
    calendar: any;
    event: any;
    account: any;
  };
}

export function loadFixtures(): MockFixtures {
  return {
    google: {
      calendar: {
        id: 'google-cal-1',
        summary: 'Primary Calendar',
        timeZone: 'America/Los_Angeles',
        primary: true,
        accessRole: 'owner',
      },
      event: {
        id: 'google-event-1',
        summary: 'Team Meeting',
        description: 'Weekly sync',
        start: { dateTime: '2024-01-15T10:00:00-07:00', timeZone: 'America/Los_Angeles' },
        end: { dateTime: '2024-01-15T11:00:00-07:00', timeZone: 'America/Los_Angeles' },
        attendees: [{ email: 'colleague@example.com', responseStatus: 'accepted' }],
        status: 'confirmed',
      },
      account: {
        id: 'google-user-1',
        email: 'user@gmail.com',
        name: 'Test User',
      },
    },
    microsoft: {
      calendar: {
        id: 'ms-cal-1',
        name: 'Calendar',
        isDefaultCalendar: true,
      },
      event: {
        id: 'ms-event-1',
        subject: 'Team Meeting',
        body: { contentType: 'text', content: 'Weekly sync' },
        start: { dateTime: '2024-01-15T10:00:00', timeZone: 'Pacific Standard Time' },
        end: { dateTime: '2024-01-15T11:00:00', timeZone: 'Pacific Standard Time' },
      },
      account: {
        id: 'ms-user-1',
        displayName: 'Test User',
        mail: 'user@outlook.com',
      },
    },
  };
}

export function createTestAccount(provider: 'google' | 'microsoft' | 'caldav' = 'google') {
  return {
    id: `test-account-${Date.now()}`,
    provider,
    displayName: 'Test Account',
    email: 'test@example.com',
    status: 'connected' as const,
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
  };
}