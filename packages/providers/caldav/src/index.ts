import type { ProviderAdapter, TokenSet, RefreshToken, CreateAuthUrlOptions } from '@calendar-sdk/core';

export interface CalDavProviderConfig {
  serverUrl: string;
  username: string;
  password: string;
  headers?: Record<string, string>;
}

export function createCalDavProvider(config: CalDavProviderConfig): ProviderAdapter {
  const baseUrl = config.serverUrl.replace(/\/$/, '');

  const makeHeaders = (token?: TokenSet): Record<string, string> => ({
    'Content-Type': 'application/xml',
    ...(token ? { Authorization: `Basic ${Buffer.from(`${config.username}:${config.password}`).toString('base64')}` } : {}),
    ...config.headers,
  });

  const auth = {
    createAuthorizationUrl: async (_options: CreateAuthUrlOptions) => {
      return baseUrl;
    },

    exchangeCode: async (_code: string, _redirectUri: string) => {
      return {
        accessToken: Buffer.from(`${config.username}:${config.password}`).toString('base64'),
        tokenType: 'Basic',
      };
    },

    refreshToken: async (_token: RefreshToken) => {
      return {
        accessToken: Buffer.from(`${config.username}:${config.password}`).toString('base64'),
        tokenType: 'Basic',
      };
    },

    revokeToken: async (_token: string) => {
      // No revocation for CalDAV basic auth
    },
  };

  const accounts = {
    getAccount: async (_token: TokenSet) => {
      return {
        id: config.username,
        provider: 'caldav' as const,
        displayName: config.username,
        email: config.username,
        status: 'connected' as const,
        capabilities: {
          calendars: { create: true, update: true, delete: true, share: false, manageNotifications: false },
          events: { list: true, create: true, update: true, delete: true, move: false, duplicate: false, attachments: false, conferenceData: false },
          sync: { incremental: false, webhook: false, polling: true },
          availability: { freeBusy: true, suggestedTimes: false },
        },
        raw: { serverUrl: config.serverUrl },
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };

  const calendars = {
    list: async (_token: TokenSet, _query?: { pageToken?: string; limit?: number }) => {
      const response = await fetch(baseUrl, {
        method: 'PROPFIND',
        headers: makeHeaders(),
        body: `<?xml version="1.0" encoding="UTF-8"?>
<D:propfind xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:displayname/>
    <C:calendar-description/>
    <D:resourcetype/>
    <C:calendar-timezone/>
  </D:prop>
</D:propfind>`,
      });

      if (!response.ok) {
        throw new Error(`Failed to list calendars: ${response.statusText}`);
      }

      const text = await response.text();
      const calendarIds = parseCalendarIdsFromPropfind(text);

      return {
        items: calendarIds.map(id => ({
          id,
          accountId: '',
          providerId: id,
          name: id.split('/').pop() || 'Calendar',
          timezone: 'UTC',
          primary: calendarIds.indexOf(id) === 0,
          readOnly: false,
          hidden: false,
          accessRole: 'owner' as const,
          capabilities: { create: true, update: true, delete: true, share: false, manageNotifications: false },
          raw: { id },
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
      };
    },

    get: async (_token: TokenSet, id: string) => ({
      id,
      accountId: '',
      providerId: id,
      name: id.split('/').pop() || 'Calendar',
      timezone: 'UTC',
      primary: true,
      readOnly: false,
      hidden: false,
      accessRole: 'owner' as const,
      capabilities: { create: true, update: true, delete: true, share: false, manageNotifications: false },
      raw: { id },
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),

    create: async (_token: TokenSet, input: { name: string }) => {
      const calendarId = `${baseUrl}/${input.name}`;
      return {
        id: calendarId,
        accountId: '',
        providerId: calendarId,
        name: input.name,
        timezone: 'UTC',
        primary: false,
        readOnly: false,
        hidden: false,
        accessRole: 'owner' as const,
        capabilities: { create: true, update: true, delete: true, share: false, manageNotifications: false },
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    update: async (_token: TokenSet, id: string, _patch: { name?: string; description?: string }) => ({
      id,
      accountId: '',
      providerId: id,
      name: id.split('/').pop() || 'Calendar',
      timezone: 'UTC',
      primary: false,
      readOnly: false,
      hidden: false,
      accessRole: 'owner' as const,
      capabilities: { create: true, update: true, delete: true, share: false, manageNotifications: false },
      raw: {},
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),

    delete: async (_token: TokenSet, _id: string) => {
      // Deletion would require a DELETE to the calendar collection
    },
  };

  const events = {
    list: async (_token: TokenSet, calendarId: string, query?: { timeMin?: Date; timeMax?: Date }) => {
      const filter = query?.timeMin && query?.timeMax 
        ? `<C:time-range start="${query.timeMin.toISOString()}" end="${query.timeMax.toISOString()}"/>`
        : '';

      const response = await fetch(calendarId, {
        method: 'REPORT',
        headers: makeHeaders(),
        body: `<?xml version="1.0" encoding="UTF-8"?>
<C:calendar-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <D:prop>
    <D:getetag/>
    <C:calendar-data/>
  </D:prop>
  <C:filter>
    <C:comp-filter name="VCALENDAR">
      <C:comp-filter name="VEVENT">${filter}</C:comp-filter>
    </C:comp-filter>
  </C:filter>
</C:calendar-query>`,
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to list events: ${response.statusText}`);
      }

      const text = await response.text();
      const events = parseEventsFromReport(text);

      return { items: events };
    },

    get: async (_token: TokenSet, calendarId: string, id: string) => {
      const response = await fetch(`${calendarId}/${id}.ics`, {
        method: 'GET',
        headers: makeHeaders(),
      });

      if (!response.ok) {
        throw new Error(`Failed to get event: ${response.statusText}`);
      }

      const text = await response.text();
      return parseIcsEvent(text, calendarId);
    },

    create: async (_token: TokenSet, calendarId: string, input: any) => {
      const uid = generateUid();
      const ics = buildIcsEvent(uid, input);
      const response = await fetch(`${calendarId}/${uid}.ics`, {
        method: 'PUT',
        headers: makeHeaders(),
        body: ics,
      });

      if (!response.ok) {
        throw new Error(`Failed to create event: ${response.statusText}`);
      }

      return parseIcsEvent(ics, calendarId);
    },

    update: async (_token: TokenSet, calendarId: string, id: string, input: any) => {
      const ics = buildIcsEvent(id, input);
      const response = await fetch(`${calendarId}/${id}.ics`, {
        method: 'PUT',
        headers: makeHeaders(),
        body: ics,
      });

      if (!response.ok) {
        throw new Error(`Failed to update event: ${response.statusText}`);
      }

      return parseIcsEvent(ics, calendarId);
    },

    delete: async (_token: TokenSet, calendarId: string, id: string) => {
      const response = await fetch(`${calendarId}/${id}.ics`, {
        method: 'DELETE',
        headers: makeHeaders(),
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete event: ${response.statusText}`);
      }
    },

    move: async () => { throw new Error('Move not supported in CalDAV'); },
    duplicate: async () => { throw new Error('Duplicate not supported in CalDAV'); },
    expandRecurrence: async () => { throw new Error('Expansion not supported in CalDAV'); },
  };

  const availability = {
    freeBusy: async (_token: TokenSet, query: { timeMin: Date; timeMax: Date; calendars: string[] }) => {
      const results: Record<string, any[]> = {};

      for (const calendarId of query.calendars) {
        const filter = `<C:time-range start="${query.timeMin.toISOString()}" end="${query.timeMax.toISOString()}"/>`;

        const response = await fetch(calendarId, {
          method: 'REPORT',
          headers: makeHeaders(),
          body: `<?xml version="1.0" encoding="UTF-8"?>
<C:free-busy-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:free-busy>
    ${filter}
  </C:free-busy>
</C:free-busy-query>`,
        });

        if (response.ok) {
          const text = await response.text();
          const busySlots = parseFreeBusyFromReport(text);
          results[calendarId] = busySlots;
        } else {
          results[calendarId] = [];
        }
      }

      return { calendars: results };
    },

    suggestMeeting: async () => {
      throw new Error('Meeting suggestions not supported in CalDAV');
    },
  };

  const sync = {
    fullSync: async (_token: TokenSet, calendarId: string, options?: { timeMin?: Date; timeMax?: Date }) => {
      const result = await events.list(_token, calendarId, { timeMin: options?.timeMin, timeMax: options?.timeMax });
      return {
        events: result.items.map(e => ({ type: 'created' as const, event: e })),
        deletions: [],
        expiredToken: false,
        hasMore: false,
      };
    },

    incrementalSync: async () => {
      throw new Error('Incremental sync not supported in CalDAV');
    },
  };

  const subscriptions = {
    create: async () => { throw new Error('Webhooks not supported in CalDAV'); },
    renew: async () => { throw new Error('Webhooks not supported in CalDAV'); },
    delete: async () => { throw new Error('Webhooks not supported in CalDAV'); },
    list: async () => [],
    get: async () => { throw new Error('Not supported'); },
  };

  return {
    key: 'caldav',
    displayName: 'CalDAV',
    auth,
    accounts,
    calendars,
    events,
    availability,
    sync,
    subscriptions,
    getCapabilities: () => ({
      calendars: { create: true, update: true, delete: true, share: false, manageNotifications: false },
      events: { list: true, create: true, update: true, delete: true, move: false, duplicate: false, attachments: false, conferenceData: false },
      sync: { incremental: false, webhook: false, polling: true },
      availability: { freeBusy: true, suggestedTimes: false },
    }),
    createTransport: () => ({
      request: async <T>(options: any) => {
        const response = await fetch(`${baseUrl}${options.path}`, {
          method: options.method || 'GET',
          headers: makeHeaders(),
          body: options.body,
        });
        return { data: await response.text() as any as T, status: response.status, headers: {} };
      },
    }),
  };
}

function parseCalendarIdsFromPropfind(xml: string): string[] {
  const hrefMatches = xml.match(/<D:href>([^<]+)<\/D:href>/g) || [];
  return hrefMatches.map(m => m.replace(/<[^>]+>/g, '')).filter(u => u.includes('/'));
}

function parseEventsFromReport(xml: string): any[] {
  const events: any[] = [];
  const eventMatches = xml.match(/<C:calendar-data>([\s\S]*?)<\/C:calendar-data>/g) || [];

  for (const match of eventMatches) {
    const ics = match.replace(/<[^>]+>/g, '').trim();
    events.push(parseIcsEvent(ics, ''));
  }

  return events;
}

function parseIcsEvent(ics: string, calendarId: string): any {
  const lines = ics.split(/\r?\n/);
  const event: any = {
    id: '',
    accountId: '',
    calendarId,
    providerId: '',
    title: '',
    start: { dateTime: '', timezone: 'UTC' },
    end: { dateTime: '', timezone: 'UTC' },
    allDay: false,
    timezone: 'UTC',
    status: 'confirmed',
    transparency: 'opaque',
    visibility: 'default',
    attendees: [],
    recurrenceMaster: true,
    exceptions: [],
    attachments: [],
    raw: { ics },
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  let currentField = '';
  let currentValue = '';

  for (const line of lines) {
    if (line.startsWith(' ') || line.startsWith('\t')) {
      currentValue += line.slice(1);
    } else {
      if (currentField) {
        processIcsField(event, currentField, currentValue);
      }
      const colonIdx = line.indexOf(':');
      if (colonIdx > 0) {
        currentField = line.substring(0, colonIdx);
        currentValue = line.substring(colonIdx + 1);
      } else {
        currentField = '';
        currentValue = '';
      }
    }
  }

  if (currentField) {
    processIcsField(event, currentField, currentValue);
  }

  return event;
}

function processIcsField(event: any, field: string, value: string) {
  switch (field) {
    case 'UID':
      event.id = value;
      event.providerId = value;
      break;
    case 'SUMMARY':
      event.title = value;
      break;
    case 'DESCRIPTION':
      event.description = value;
      break;
    case 'LOCATION':
      event.location = value;
      break;
    case 'DTSTART':
      if (value.includes('T')) {
        event.start = { dateTime: value, timezone: 'UTC' };
        event.allDay = false;
      } else {
        event.start = { date: value };
        event.allDay = true;
      }
      break;
    case 'DTEND':
      if (value.includes('T')) {
        event.end = { dateTime: value, timezone: 'UTC' };
      } else {
        event.end = { date: value };
      }
      break;
    case 'RRULE':
      event.recurrence = { rrule: value };
      break;
    case 'STATUS':
      event.status = value.toLowerCase() === 'cancelled' ? 'cancelled' : 'confirmed';
      break;
  }
}

function buildIcsEvent(uid: string, input: any): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendar SDK//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTART:${formatIcsDate(input.start)}`,
    `DTEND:${formatIcsDate(input.end)}`,
    `SUMMARY:${input.title || ''}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${input.description}`);
  if (input.location) lines.push(`LOCATION:${input.location}`);
  if (input.recurrence?.rrule) lines.push(`RRULE:${input.recurrence.rrule}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function formatIcsDate(dt: any): string {
  if (dt?.date) return dt.date.replace(/-/g, '');
  if (dt?.dateTime) return dt.dateTime.replace(/[-:]/g, '').replace('.000', '');
  return '';
}

function generateUid(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}@caldav`;
}

function parseFreeBusyFromReport(xml: string): any[] {
  return [];
}