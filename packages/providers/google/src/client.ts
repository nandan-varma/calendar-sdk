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
  SyncResult,
  ExpandedOccurrence,
  DateTimeValue,
  ShareCalendarInput,
  RetryOptions,
} from '@nandan-varma/calendar-sdk';
import type { Logger } from '@nandan-varma/calendar-sdk';
import { CalendarSdkError, createTransport, defaultRetryOptions } from '@nandan-varma/calendar-sdk';
import type {
  GoogleCalendarListResponse,
  GoogleEventsResponse,
  GoogleFreeBusy,
  GoogleWatchResponse,
  GoogleTokenResponse,
  GoogleUser,
} from './types/index.js';
import { mapEventsResponse } from './mappers/index.js';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  logger?: Logger;
  /** Bring your own fetch (proxying, instrumentation, test doubles, ...). */
  fetch?: typeof fetch;
  /** Overrides for the SDK's default retry/backoff policy. */
  retryOptions?: Partial<RetryOptions>;
}

export function createGoogleProvider(config: GoogleProviderConfig): ProviderAdapter {
  const logger = config.logger;
  const retryOptions: RetryOptions = { ...defaultRetryOptions, ...config.retryOptions };
  const transport = createTransport('google', { fetch: config.fetch, retryOptions }, logger);

  const authHeader = (token: TokenSet) => ({ Authorization: `Bearer ${token.accessToken}` });

  const auth: ProviderAdapter['auth'] = {
    createAuthorizationUrl: async (options: CreateAuthUrlOptions) => {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri || config.redirectUri || '',
        response_type: 'code',
        scope: options.scope.join(' '),
        access_type: options.accessType || 'online',
        ...(options.state && { state: options.state }),
        ...(options.prompt && { prompt: options.prompt }),
      });
      return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
    },

    exchangeCode: async (code: string, redirectUri: string) => {
      const { data } = await transport.request<GoogleTokenResponse>({
        method: 'POST',
        path: 'https://oauth2.googleapis.com/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret || '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }).toString(),
      });

      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    refreshToken: async (token: RefreshToken) => {
      const { data } = await transport.request<GoogleTokenResponse>({
        method: 'POST',
        path: 'https://oauth2.googleapis.com/token',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: token.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret || '',
          grant_type: 'refresh_token',
        }).toString(),
      });

      return {
        accessToken: data.access_token,
        refreshToken: token.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    revokeToken: async (token: string) => {
      await transport.request({
        method: 'POST',
        path: 'https://oauth2.googleapis.com/revoke',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
        responseType: 'text',
      });
    },
  };

  const accounts: ProviderAdapter['accounts'] = {
    getAccount: async (token: TokenSet) => {
      const { data: user } = await transport.request<GoogleUser>({
        path: 'https://www.googleapis.com/oauth2/v2/userinfo',
        headers: authHeader(token),
      });

      return {
        id: user.id,
        provider: 'google' as const,
        displayName: user.name || user.email,
        email: user.email,
        status: 'connected' as const,
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
          availability: { freeBusy: true, suggestedTimes: false },
        },
        raw: user,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };

  const calendars: CalendarsProviderMethods = {
    list: async (token, query) => {
      const params: Record<string, string> = {};
      if (query?.pageToken) params.pageToken = query.pageToken;
      if (query?.limit) params.maxResults = String(query.limit);
      if (query?.showHidden !== false) params.showDeleted = 'false';

      const { data } = await transport.request<GoogleCalendarListResponse>({
        path: `${BASE_URL}/users/me/calendarList`,
        query: params,
        headers: authHeader(token),
      });

      return {
        items: data.items.map((entry) => ({
          id: entry.id,
          accountId: '',
          providerId: entry.id,
          name: entry.summary,
          description: entry.description,
          timezone: entry.timeZone || 'UTC',
          color: entry.color || entry.backgroundColor,
          primary: entry.selected ?? false,
          readOnly: entry.accessRole === 'reader' || entry.accessRole === 'freeBusyReader',
          hidden: !entry.selected,
          accessRole: mapAccessRole(entry.accessRole),
          capabilities: {
            create: entry.accessRole === 'owner' || entry.accessRole === 'writer',
            update: entry.accessRole === 'owner' || entry.accessRole === 'writer',
            delete: entry.accessRole === 'owner',
            share: entry.accessRole === 'owner',
            manageNotifications: entry.accessRole === 'owner' || entry.accessRole === 'writer',
          },
          raw: entry,
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        nextPageToken: data.nextPageToken,
      };
    },

    get: async (token, id) => {
      const { data: entry } = await transport.request<any>({
        path: `${BASE_URL}/users/me/calendars/${encodeURIComponent(id)}`,
        headers: authHeader(token),
      });

      return {
        id: entry.id,
        accountId: '',
        providerId: entry.id,
        name: entry.summary,
        description: entry.description,
        timezone: entry.timeZone || 'UTC',
        color: entry.color || entry.backgroundColor,
        primary: entry.primary ?? false,
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
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    create: async (token, input) => {
      const { data: entry } = await transport.request<any>({
        method: 'POST',
        path: `${BASE_URL}/users/me/calendars`,
        headers: authHeader(token),
        body: {
          summary: input.name,
          description: input.description,
          timeZone: input.timezone,
          backgroundColor: input.color,
        },
      });

      return {
        id: entry.id,
        accountId: '',
        providerId: entry.id,
        name: entry.summary,
        description: entry.description,
        timezone: entry.timeZone || 'UTC',
        color: entry.backgroundColor,
        primary: false,
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
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    update: async (token, id, patch) => {
      const { data: entry } = await transport.request<any>({
        method: 'PATCH',
        path: `${BASE_URL}/users/me/calendars/${encodeURIComponent(id)}`,
        headers: authHeader(token),
        body: {
          summary: patch.name,
          description: patch.description,
          timeZone: patch.timezone,
          backgroundColor: patch.color,
          hidden: patch.hidden,
        },
      });

      return {
        id: entry.id,
        accountId: '',
        providerId: entry.id,
        name: entry.summary,
        description: entry.description,
        timezone: entry.timeZone || 'UTC',
        color: entry.backgroundColor,
        primary: entry.primary ?? false,
        readOnly: false,
        hidden: entry.hidden ?? false,
        accessRole: 'owner' as const,
        capabilities: {
          create: true,
          update: true,
          delete: true,
          share: true,
          manageNotifications: true,
        },
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    delete: async (token, id) => {
      await deleteIgnoring404(() =>
        transport.request({
          method: 'DELETE',
          path: `${BASE_URL}/users/me/calendars/${encodeURIComponent(id)}`,
          headers: authHeader(token),
          responseType: 'text',
        })
      );
    },

    // Google Calendar ACL: https://developers.google.com/workspace/calendar/api/v3/reference/acl/insert
    share: async (token: TokenSet, calendarId: string, input: ShareCalendarInput) => {
      await transport.request({
        method: 'POST',
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/acl`,
        query: input.sendNotifications === false ? { sendNotifications: 'false' } : undefined,
        headers: authHeader(token),
        body: {
          role: input.role,
          scope: { type: 'user', value: input.email },
        },
      });
    },
  };

  const events: EventsProviderMethods = {
    list: async (token, calendarId, query) => {
      const params: Record<string, string> = {};
      if (query?.pageToken) params.pageToken = query.pageToken;
      if (query?.limit) params.maxResults = String(query.limit);
      if (query?.timeMin) params.timeMin = query.timeMin.toISOString();
      if (query?.timeMax) params.timeMax = query.timeMax.toISOString();
      if (query?.showDeleted) params.showDeleted = 'true';
      if (query?.singleEvents) params.singleEvents = 'true';
      if (query?.orderBy) params.orderBy = query.orderBy;
      if (query?.q) params.q = query.q;

      const { data } = await transport.request<GoogleEventsResponse>({
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        query: params,
        headers: authHeader(token),
      });

      const mapped = mapEventsResponse(data, '', '', calendarId);
      return { items: mapped.items, nextPageToken: mapped.nextPageToken };
    },

    get: async (token, calendarId, id) => {
      const { data: event } = await transport.request<any>({
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
        headers: authHeader(token),
      });

      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    create: async (token, calendarId, input, _options) => {
      const body: Record<string, unknown> = {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: input.allDay
          ? { date: (input.start as any).date }
          : { dateTime: (input.start as any).dateTime, timeZone: (input.start as any).timezone },
        end: input.allDay
          ? { date: (input.end as any).date }
          : { dateTime: (input.end as any).dateTime, timeZone: (input.end as any).timezone },
        transparency: input.transparency === 'transparent' ? 'transparent' : 'opaque',
        visibility:
          input.visibility === 'public'
            ? 'public'
            : input.visibility === 'private'
              ? 'private'
              : 'default',
        status: input.status === 'tentative' ? 'tentative' : 'confirmed',
      };

      if (input.attendees) {
        body.attendees = input.attendees.map((a) => ({
          email: a.email,
          displayName: a.displayName,
        }));
      }
      if (input.recurrence?.rrule) {
        body.recurrence = [input.recurrence.rrule];
      }
      if (input.reminders) {
        body.reminders = {
          useDefault: false,
          overrides: input.reminders.map((r) => ({ method: r.method, minutes: r.minutes })),
        };
      }

      const { data: event } = await transport.request<any>({
        method: 'POST',
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        headers: authHeader(token),
        body,
      });

      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    update: async (token, calendarId, id, patch, _options) => {
      const body: Record<string, unknown> = {};

      if (patch.title !== undefined) body.summary = patch.title;
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.location !== undefined) body.location = patch.location;
      if (patch.start !== undefined)
        body.start = patch.allDay
          ? { date: (patch.start as any).date }
          : { dateTime: (patch.start as any).dateTime, timeZone: (patch.start as any).timezone };
      if (patch.end !== undefined)
        body.end = patch.allDay
          ? { date: (patch.end as any).date }
          : { dateTime: (patch.end as any).dateTime, timeZone: (patch.end as any).timezone };
      if (patch.transparency !== undefined)
        body.transparency = patch.transparency === 'transparent' ? 'transparent' : 'opaque';
      if (patch.visibility !== undefined)
        body.visibility =
          patch.visibility === 'public'
            ? 'public'
            : patch.visibility === 'private'
              ? 'private'
              : 'default';
      if (patch.attendees !== undefined)
        body.attendees = patch.attendees.map((a) => ({
          email: a.email,
          displayName: a.displayName,
        }));
      if (patch.recurrence !== undefined)
        body.recurrence = patch.recurrence?.rrule ? [patch.recurrence.rrule] : [];
      if (patch.reminders !== undefined)
        body.reminders = patch.reminders
          ? {
              useDefault: false,
              overrides: patch.reminders.map((r) => ({ method: r.method, minutes: r.minutes })),
            }
          : { useDefault: false };

      const { data: event } = await transport.request<any>({
        method: 'PATCH',
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
        headers: authHeader(token),
        body,
      });

      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    delete: async (token, calendarId, id, _options) => {
      await deleteIgnoring404(() =>
        transport.request({
          method: 'DELETE',
          path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
          headers: authHeader(token),
          responseType: 'text',
        })
      );
    },

    move: async (token, eventId, sourceCalendarId, targetCalendarId) => {
      const { data: event } = await transport.request<any>({
        method: 'POST',
        path: `${BASE_URL}/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move`,
        query: { destination: targetCalendarId },
        headers: authHeader(token),
      });

      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', targetCalendarId)
        .items[0];
    },

    duplicate: async (token, eventId, targetCalendarId) => {
      const { data: source } = await transport.request<any>({
        path: `${BASE_URL}/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(eventId)}`,
        headers: authHeader(token),
      });

      const clone = { ...source };
      delete clone.id;
      delete clone.etag;
      delete clone.htmlLink;
      delete clone.created;
      delete clone.updated;

      const { data: newEvent } = await transport.request<any>({
        method: 'POST',
        path: `${BASE_URL}/calendars/${encodeURIComponent(targetCalendarId)}/events`,
        headers: authHeader(token),
        body: clone,
      });

      return mapEventsResponse({ items: [newEvent], kind: '', etag: '' }, '', '', targetCalendarId)
        .items[0];
    },

    expandRecurrence: async (token, calendarId, eventId, timeMin, timeMax) => {
      const { data } = await transport.request<GoogleEventsResponse>({
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances`,
        query: {
          singleEvents: 'true',
          timeMin: timeMin.toISOString(),
          timeMax: timeMax.toISOString(),
        },
        headers: authHeader(token),
      });

      return data.items.map(
        (e): ExpandedOccurrence => ({
          id: e.id,
          eventId,
          title: e.summary || '(No title)',
          start: (e.start?.dateTime
            ? { dateTime: e.start.dateTime, timezone: e.start.timeZone || 'UTC' }
            : { date: e.start?.date || '' }) as DateTimeValue,
          end: (e.end?.dateTime
            ? { dateTime: e.end.dateTime, timezone: e.end.timeZone || 'UTC' }
            : { date: e.end?.date || '' }) as DateTimeValue,
          allDay: !!e.start?.date,
          status:
            e.status === 'confirmed'
              ? 'confirmed'
              : e.status === 'tentative'
                ? 'tentative'
                : 'cancelled',
          location: e.location,
          recurrenceException: false,
        })
      );
    },
  };

  const availability: AvailabilityProviderMethods = {
    freeBusy: async (token, query) => {
      const { data } = await transport.request<GoogleFreeBusy>({
        method: 'POST',
        path: `${BASE_URL}/freeBusy`,
        headers: authHeader(token),
        body: {
          timeMin: query.timeMin.toISOString(),
          timeMax: query.timeMax.toISOString(),
          timeZone: query.timezone || 'UTC',
          items: query.calendars.map((id) => ({ id })),
        },
      });

      const result: Record<
        string,
        Array<{ start: Date; end: Date; status: 'free' | 'busy' | 'tentative' | 'unknown' }>
      > = {};

      for (const [calId, calData] of Object.entries(data.calendars)) {
        result[calId] = (calData.busy || []).map((b) => ({
          start: new Date(b.start),
          end: new Date(b.end),
          status: 'busy' as const,
        }));
      }

      return { calendars: result, timezone: data.timeZone };
    },

    suggestMeeting: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Meeting time suggestions are not supported by Google Calendar',
        provider: 'google',
      });
    },
  };

  const sync: SyncProviderMethods = {
    fullSync: async (token, calendarId, options) => {
      const params: Record<string, string> = { singleEvents: 'true', showDeleted: 'false' };
      if (options?.timeMin) params.timeMin = options.timeMin.toISOString();
      if (options?.timeMax) params.timeMax = options.timeMax.toISOString();
      if (options?.limit) params.maxResults = String(options.limit);

      const { data } = await transport.request<GoogleEventsResponse>({
        path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
        query: params,
        headers: authHeader(token),
      });

      const mapped = mapEventsResponse(data, '', '', calendarId);

      return {
        accountId: '',
        scope: 'events' as const,
        events: mapped.items.map((e) => ({ type: 'created' as const, event: e })),
        deletions: [],
        nextCursor: mapped.nextSyncToken
          ? { token: mapped.nextSyncToken, expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
          : undefined,
        expiredToken: false,
        hasMore: !!mapped.nextPageToken,
      } as SyncResult;
    },

    incrementalSync: async (token, calendarId, cursor) => {
      try {
        const { data } = await transport.request<GoogleEventsResponse>({
          path: `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events`,
          query: { singleEvents: 'true', showDeleted: 'true', syncToken: cursor.token },
          headers: authHeader(token),
        });

        const mapped = mapEventsResponse(data, '', '', calendarId);

        const events: Array<{
          type: 'created' | 'updated' | 'deleted';
          event?: any;
          eventId?: string;
        }> = [];
        for (const item of mapped.items) {
          if (item.deletedAt) {
            events.push({ type: 'deleted', eventId: item.id });
          } else {
            events.push({ type: 'created', event: item });
          }
        }

        return {
          accountId: '',
          scope: 'events' as const,
          events,
          deletions: [],
          nextCursor: mapped.nextSyncToken
            ? {
                token: mapped.nextSyncToken,
                expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
              }
            : undefined,
          expiredToken: false,
          hasMore: !!mapped.nextPageToken,
        } as SyncResult;
      } catch (error) {
        if (error instanceof CalendarSdkError && error.status === 410) {
          return {
            accountId: '',
            scope: 'events' as const,
            events: [],
            deletions: [],
            expiredToken: true,
            hasMore: false,
          } as SyncResult;
        }
        throw error;
      }
    },
  };

  const subscriptions: SubscriptionsProviderMethods = {
    create: async (token, config) => {
      const { data } = await transport.request<GoogleWatchResponse>({
        method: 'POST',
        path: `${BASE_URL}/calendars/${encodeURIComponent(config.resource)}/watch`,
        headers: authHeader(token),
        body: {
          id: crypto.randomUUID(),
          type: 'web_hook',
          address: config.webhookUrl,
          expiration: config.leaseDurationSeconds
            ? String(Date.now() + config.leaseDurationSeconds * 1000)
            : String(Date.now() + 7 * 24 * 60 * 60 * 1000),
          // Google echoes this back as the X-Goog-Channel-Token header on every notification -
          // without it, `config.secret` was accepted by the SDK but never actually sent to
          // Google, so there was no way to verify a notification really came from this channel.
          ...(config.secret ? { token: config.secret } : {}),
        },
      });

      return {
        id: data.channelId,
        accountId: '',
        provider: 'google',
        resource: config.resource,
        webhookUrl: config.webhookUrl,
        leaseExpiry: new Date(Number.parseInt(data.expiration)),
        secret: config.secret,
        renewalPolicy: 'auto',
        status: 'active',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    renew: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Google watch channels cannot be renewed in place',
        provider: 'google',
        remediation:
          'Call subscriptions.create() again to open a new channel before the old one expires.',
      });
    },

    delete: async (token, subscriptionId) => {
      await transport.request({
        method: 'POST',
        path: `${BASE_URL}/channels/stop`,
        headers: authHeader(token),
        body: { id: subscriptionId },
        responseType: 'text',
      });
    },

    list: async () => [],

    get: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Google does not support fetching a single watch channel by id',
        provider: 'google',
      });
    },
  };

  return {
    key: 'google',
    displayName: 'Google Calendar',
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

function mapAccessRole(role: string): 'owner' | 'writer' | 'reader' | 'freeBusyReader' | 'none' {
  switch (role) {
    case 'owner':
      return 'owner';
    case 'writer':
      return 'writer';
    case 'reader':
      return 'reader';
    case 'freeBusyReader':
      return 'freeBusyReader';
    default:
      return 'none';
  }
}
