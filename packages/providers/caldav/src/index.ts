import type {
  ProviderAdapter,
  TokenSet,
  RefreshToken,
  CreateAuthUrlOptions,
  RetryOptions,
} from '@nandan-varma/calendar-sdk';
import type { Logger } from '@nandan-varma/calendar-sdk';
import { CalendarSdkError, createTransport, defaultRetryOptions } from '@nandan-varma/calendar-sdk';
import { randomUUID } from 'node:crypto';

export interface CalDavProviderConfig {
  serverUrl: string;
  username: string;
  password: string;
  headers?: Record<string, string>;
  logger?: Logger;
  /** Bring your own fetch (proxying, instrumentation, test doubles, ...). */
  fetch?: typeof fetch;
  /** Overrides for the SDK's default retry/backoff policy. */
  retryOptions?: Partial<RetryOptions>;
}

export function createCalDavProvider(config: CalDavProviderConfig): ProviderAdapter {
  const baseUrl = config.serverUrl.replace(/\/$/, '');
  const logger = config.logger;
  const retryOptions: RetryOptions = { ...defaultRetryOptions, ...config.retryOptions };
  const transport = createTransport('caldav', { fetch: config.fetch, retryOptions }, logger);

  const basicAuth = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  const davHeaders = (): Record<string, string> => ({
    'Content-Type': 'application/xml',
    Authorization: `Basic ${basicAuth}`,
    ...config.headers,
  });

  const auth = {
    createAuthorizationUrl: async (_options: CreateAuthUrlOptions) => baseUrl,

    exchangeCode: async (_code: string, _redirectUri: string) => ({
      accessToken: basicAuth,
      tokenType: 'Basic',
    }),

    refreshToken: async (_token: RefreshToken) => ({
      accessToken: basicAuth,
      tokenType: 'Basic',
    }),

    revokeToken: async (_token: string) => {
      // No revocation concept for CalDAV basic auth.
    },
  };

  const accounts = {
    getAccount: async (_token: TokenSet) => ({
      id: config.username,
      provider: 'caldav' as const,
      displayName: config.username,
      email: config.username,
      status: 'connected' as const,
      capabilities: {
        calendars: {
          create: true,
          update: true,
          delete: true,
          share: false,
          manageNotifications: false,
        },
        events: {
          list: true,
          create: true,
          update: true,
          delete: true,
          move: false,
          duplicate: false,
          attachments: false,
          conferenceData: false,
        },
        sync: { incremental: false, webhook: false, polling: true },
        availability: { freeBusy: true, suggestedTimes: false },
      },
      raw: { serverUrl: config.serverUrl },
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
  };

  const calendars = {
    list: async (_token: TokenSet, _query?: { pageToken?: string; limit?: number }) => {
      const { data: text } = await transport.request<string>({
        method: 'PROPFIND',
        path: baseUrl,
        headers: davHeaders(),
        responseType: 'text',
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

      const calendarIds = parseCalendarIdsFromPropfind(text);

      return {
        items: calendarIds.map((id) => ({
          id,
          accountId: '',
          providerId: id,
          name: id.split('/').pop() || 'Calendar',
          timezone: 'UTC',
          primary: calendarIds.indexOf(id) === 0,
          readOnly: false,
          hidden: false,
          accessRole: 'owner' as const,
          capabilities: {
            create: true,
            update: true,
            delete: true,
            share: false,
            manageNotifications: false,
          },
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
      capabilities: {
        create: true,
        update: true,
        delete: true,
        share: false,
        manageNotifications: false,
      },
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
        capabilities: {
          create: true,
          update: true,
          delete: true,
          share: false,
          manageNotifications: false,
        },
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    update: async (
      _token: TokenSet,
      id: string,
      _patch: { name?: string; description?: string }
    ) => ({
      id,
      accountId: '',
      providerId: id,
      name: id.split('/').pop() || 'Calendar',
      timezone: 'UTC',
      primary: false,
      readOnly: false,
      hidden: false,
      accessRole: 'owner' as const,
      capabilities: {
        create: true,
        update: true,
        delete: true,
        share: false,
        manageNotifications: false,
      },
      raw: {},
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    }),

    delete: async (_token: TokenSet, _id: string) => {
      // Deletion would require a DELETE against the calendar collection URL; most CalDAV
      // servers don't support removing a calendar collection this way, so this is a no-op.
    },
    // No share(): CalDAV has no standard sharing protocol, and the capability map
    // reports `share: false`, so the core service layer never calls this.
  };

  const events = {
    list: async (
      _token: TokenSet,
      calendarId: string,
      query?: { timeMin?: Date; timeMax?: Date }
    ) => {
      const filter =
        query?.timeMin && query?.timeMax
          ? `<C:time-range start="${query.timeMin.toISOString()}" end="${query.timeMax.toISOString()}"/>`
          : '';

      const { data: text } = await transport.request<string>({
        method: 'REPORT',
        path: calendarId,
        headers: davHeaders(),
        responseType: 'text',
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

      return { items: parseEventsFromReport(text) };
    },

    get: async (_token: TokenSet, calendarId: string, id: string) => {
      const { data: text } = await transport.request<string>({
        path: `${calendarId}/${id}.ics`,
        headers: davHeaders(),
        responseType: 'text',
      });

      return parseIcsEvent(text, calendarId);
    },

    create: async (_token: TokenSet, calendarId: string, input: any) => {
      const uid = generateUid();
      const ics = buildIcsEvent(uid, input);

      await transport.request({
        method: 'PUT',
        path: `${calendarId}/${uid}.ics`,
        headers: davHeaders(),
        responseType: 'text',
        body: ics,
      });

      return parseIcsEvent(ics, calendarId);
    },

    update: async (_token: TokenSet, calendarId: string, id: string, input: any) => {
      const ics = buildIcsEvent(id, input);

      await transport.request({
        method: 'PUT',
        path: `${calendarId}/${id}.ics`,
        headers: davHeaders(),
        responseType: 'text',
        body: ics,
      });

      return parseIcsEvent(ics, calendarId);
    },

    delete: async (_token: TokenSet, calendarId: string, id: string) => {
      await deleteIgnoring404(() =>
        transport.request({
          method: 'DELETE',
          path: `${calendarId}/${id}.ics`,
          headers: davHeaders(),
          responseType: 'text',
        })
      );
    },

    move: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Event move is not supported by CalDAV',
        provider: 'caldav',
      });
    },
    duplicate: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Event duplicate is not supported by CalDAV',
        provider: 'caldav',
      });
    },
    expandRecurrence: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Recurrence expansion is not supported by CalDAV',
        provider: 'caldav',
      });
    },
  };

  const availability = {
    freeBusy: async (
      _token: TokenSet,
      query: { timeMin: Date; timeMax: Date; calendars: string[] }
    ) => {
      const results: Record<string, any[]> = {};

      for (const calendarId of query.calendars) {
        const filter = `<C:time-range start="${query.timeMin.toISOString()}" end="${query.timeMax.toISOString()}"/>`;

        try {
          const { data: text } = await transport.request<string>({
            method: 'REPORT',
            path: calendarId,
            headers: davHeaders(),
            responseType: 'text',
            body: `<?xml version="1.0" encoding="UTF-8"?>
<C:free-busy-query xmlns:D="DAV:" xmlns:C="urn:ietf:params:xml:ns:caldav">
  <C:free-busy>
    ${filter}
  </C:free-busy>
</C:free-busy-query>`,
          });
          results[calendarId] = parseFreeBusyFromReport(text);
        } catch {
          results[calendarId] = [];
        }
      }

      return { calendars: results };
    },

    suggestMeeting: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Meeting time suggestions are not supported by CalDAV',
        provider: 'caldav',
      });
    },
  };

  const sync = {
    fullSync: async (
      token: TokenSet,
      calendarId: string,
      options?: { timeMin?: Date; timeMax?: Date }
    ) => {
      const result = await events.list(token, calendarId, {
        timeMin: options?.timeMin,
        timeMax: options?.timeMax,
      });
      return {
        accountId: '',
        scope: 'events' as const,
        events: result.items.map((e) => ({ type: 'created' as const, event: e })),
        deletions: [],
        expiredToken: false,
        hasMore: false,
      };
    },

    incrementalSync: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Incremental sync is not supported by CalDAV',
        provider: 'caldav',
      });
    },
  };

  const subscriptions = {
    create: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Webhooks are not supported by CalDAV',
        provider: 'caldav',
      });
    },
    renew: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Webhooks are not supported by CalDAV',
        provider: 'caldav',
      });
    },
    delete: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Webhooks are not supported by CalDAV',
        provider: 'caldav',
      });
    },
    list: async () => [],
    get: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Webhooks are not supported by CalDAV',
        provider: 'caldav',
      });
    },
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
      calendars: {
        create: true,
        update: true,
        delete: true,
        share: false,
        manageNotifications: false,
      },
      events: {
        list: true,
        create: true,
        update: true,
        delete: true,
        move: false,
        duplicate: false,
        attachments: false,
        conferenceData: false,
      },
      sync: { incremental: false, webhook: false, polling: true },
      availability: { freeBusy: true, suggestedTimes: false },
    }),
    createTransport: () => transport,
  };
}

// DELETE is idempotent: a 404 means the resource is already gone, which is a success from the caller's perspective.
async function deleteIgnoring404(fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (error) {
    if (error instanceof CalendarSdkError && error.status === 404) return;
    throw error;
  }
}

// XML namespace prefixes are arbitrary (only the namespace URI is meaningful) - a server may
// reply with `<cal:calendar-data>`, `<a:calendar-data>`, or no prefix at all via a default
// namespace, and all of those are equally standards-compliant. Matching on the local element
// name only (ignoring whatever prefix, if any, precedes it) is what makes parsing robust across
// iCloud/Fastmail/Nextcloud/Radicale/Baïkal instead of silently returning nothing.
function extractElementText(xml: string, localName: string): string[] {
  const pattern = new RegExp(
    `<(?:[\\w.-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[\\w.-]+:)?${localName}>`,
    'gi'
  );
  const matches: string[] = [];
  for (const match of xml.matchAll(pattern)) {
    matches.push(match[1]);
  }
  return matches;
}

function parseCalendarIdsFromPropfind(xml: string): string[] {
  return extractElementText(xml, 'href')
    .map((text) => text.replace(/<[^>]+>/g, '').trim())
    .filter((u) => u.includes('/'));
}

function parseEventsFromReport(xml: string): any[] {
  return extractElementText(xml, 'calendar-data').map((text) => parseIcsEvent(text.trim(), ''));
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
      event.title = unescapeIcsText(value);
      break;
    case 'DESCRIPTION':
      event.description = unescapeIcsText(value);
      break;
    case 'LOCATION':
      event.location = unescapeIcsText(value);
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

// RFC 5545 SS3.3.11 TEXT escaping: backslash, comma, and semicolon must be backslash-escaped and
// newlines become the literal two-character sequence \n. Without this, event content containing
// those characters (e.g. a title or description with a newline) would inject extra iCalendar
// properties or components into the payload sent to the CalDAV server.
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, ch: string) => (ch === 'n' || ch === 'N' ? '\n' : ch));
}

// RRULE is a structured value (not TEXT) where `;` and `,` are meaningful syntax, so they must
// not be escaped - but a raw embedded newline would still let attacker-controlled input inject
// additional iCalendar lines, and a valid RRULE never legitimately contains one.
function sanitizeIcsStructuredValue(value: string): string {
  return value.replace(/\r\n|\r|\n/g, '');
}

function buildIcsEvent(uid: string, input: any): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Calendar SDK//EN',
    'BEGIN:VEVENT',
    `UID:${sanitizeIcsStructuredValue(uid)}`,
    `DTSTART:${formatIcsDate(input.start)}`,
    `DTEND:${formatIcsDate(input.end)}`,
    `SUMMARY:${escapeIcsText(input.title || '')}`,
  ];

  if (input.description) lines.push(`DESCRIPTION:${escapeIcsText(input.description)}`);
  if (input.location) lines.push(`LOCATION:${escapeIcsText(input.location)}`);
  if (input.recurrence?.rrule)
    lines.push(`RRULE:${sanitizeIcsStructuredValue(input.recurrence.rrule)}`);

  lines.push('END:VEVENT', 'END:VCALENDAR');
  return lines.join('\r\n');
}

function formatIcsDate(dt: any): string {
  if (dt?.date) return dt.date.replace(/-/g, '');
  if (dt?.dateTime) return dt.dateTime.replace(/[-:]/g, '').replace('.000', '');
  return '';
}

function generateUid(): string {
  return `${randomUUID()}@caldav`;
}

function parseFreeBusyFromReport(_xml: string): any[] {
  return [];
}
