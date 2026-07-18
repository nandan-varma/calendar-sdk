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
} from '@nandan-varma/calendar-sdk';
import type { Logger } from '@nandan-varma/calendar-sdk';
import type { 
  GoogleCalendarListResponse, 
  GoogleEventsResponse, 
  GoogleFreeBusy,
  GoogleWatchResponse,
  GoogleTokenResponse,
  GoogleUser,
} from './types/index.js';
import { mapCalendarListResponse, mapEventsResponse } from './mappers/index.js';

export interface GoogleProviderConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  logger?: Logger;
}

export function createGoogleProvider(config: GoogleProviderConfig): ProviderAdapter {
  const logger = config.logger;

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
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: config.clientId,
          client_secret: config.clientSecret || '',
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token exchange failed: ${error}`);
      }

      const data: GoogleTokenResponse = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(data.expiry_date),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    refreshToken: async (token: RefreshToken) => {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          refresh_token: token.refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret || '',
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`Token refresh failed: ${error}`);
      }

      const data: GoogleTokenResponse = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: token.refreshToken,
        expiresAt: new Date(data.expiry_date),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    revokeToken: async (token: string) => {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `token=${encodeURIComponent(token)}`,
      });
    },
  };

  const accounts: ProviderAdapter['accounts'] = {
    getAccount: async (token: TokenSet) => {
      const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to get account info');
      }

      const user: GoogleUser = await response.json();
      return {
        id: user.id,
        provider: 'google' as const,
        displayName: user.name || user.email,
        email: user.email,
        status: 'connected' as const,
        capabilities: {
          calendars: { create: true, update: true, delete: true, share: true, manageNotifications: true },
          events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
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
      const params = new URLSearchParams();
      if (query?.pageToken) params.set('pageToken', query.pageToken);
      if (query?.limit) params.set('maxResults', String(query.limit));
      if (query?.showHidden !== false) params.set('showDeleted', 'false');

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to list calendars: ${response.statusText}`);
      }

      const data: GoogleCalendarListResponse = await response.json();
      return {
        items: data.items.map((entry, _i) => ({
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
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendars/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to get calendar: ${response.statusText}`);
      }

      const entry = await response.json();
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
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    create: async (token, input) => {
      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/users/me/calendars',
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: input.name,
            description: input.description,
            timeZone: input.timezone,
            backgroundColor: input.color,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create calendar: ${response.statusText}`);
      }

      const entry = await response.json();
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
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    update: async (token, id, patch) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendars/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            summary: patch.name,
            description: patch.description,
            timeZone: patch.timezone,
            backgroundColor: patch.color,
            hidden: patch.hidden,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update calendar: ${response.statusText}`);
      }

      const entry = await response.json();
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
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: true },
        raw: entry,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    delete: async (token, id) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/users/me/calendars/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token.accessToken}` },
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete calendar: ${response.statusText}`);
      }
    },
  };

  const events: EventsProviderMethods = {
    list: async (token, calendarId, query) => {
      const params = new URLSearchParams();
      if (query?.pageToken) params.set('pageToken', query.pageToken);
      if (query?.limit) params.set('maxResults', String(query.limit));
      if (query?.timeMin) params.set('timeMin', query.timeMin.toISOString());
      if (query?.timeMax) params.set('timeMax', query.timeMax.toISOString());
      if (query?.showDeleted) params.set('showDeleted', 'true');
      if (query?.singleEvents) params.set('singleEvents', 'true');
      if (query?.orderBy) params.set('orderBy', query.orderBy);
      if (query?.q) params.set('q', query.q);

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to list events: ${response.statusText}`);
      }

      const data: GoogleEventsResponse = await response.json();
      const mapped = mapEventsResponse(data, '', '', calendarId);
      return { items: mapped.items, nextPageToken: mapped.nextPageToken };
    },

    get: async (token, calendarId, id) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to get event: ${response.statusText}`);
      }

      const event = await response.json();
      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    create: async (token, calendarId, input, _options) => {
      const body: Record<string, unknown> = {
        summary: input.title,
        description: input.description,
        location: input.location,
        start: input.allDay ? { date: (input.start as any).date } : { dateTime: (input.start as any).dateTime, timeZone: (input.start as any).timezone },
        end: input.allDay ? { date: (input.end as any).date } : { dateTime: (input.end as any).dateTime, timeZone: (input.end as any).timezone },
        transparency: input.transparency === 'transparent' ? 'transparent' : 'opaque',
        visibility: input.visibility === 'public' ? 'public' : input.visibility === 'private' ? 'private' : 'default',
        status: input.status === 'tentative' ? 'tentative' : 'confirmed',
      };

      if (input.attendees) {
        body.attendees = input.attendees.map(a => ({ email: a.email, displayName: a.displayName }));
      }

      if (input.recurrence?.rrule) {
        body.recurrence = [input.recurrence.rrule];
      }

      if (input.reminders) {
        body.reminders = {
          useDefault: false,
          overrides: input.reminders.map(r => ({ method: r.method, minutes: r.minutes })),
        };
      }

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create event: ${response.statusText}`);
      }

      const event = await response.json();
      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    update: async (token, calendarId, id, patch, _options) => {
      const body: Record<string, unknown> = {};
      
      if (patch.title !== undefined) body.summary = patch.title;
      if (patch.description !== undefined) body.description = patch.description;
      if (patch.location !== undefined) body.location = patch.location;
      if (patch.start !== undefined) body.start = patch.allDay ? { date: (patch.start as any).date } : { dateTime: (patch.start as any).dateTime, timeZone: (patch.start as any).timezone };
      if (patch.end !== undefined) body.end = patch.allDay ? { date: (patch.end as any).date } : { dateTime: (patch.end as any).dateTime, timeZone: (patch.end as any).timezone };
      if (patch.transparency !== undefined) body.transparency = patch.transparency === 'transparent' ? 'transparent' : 'opaque';
      if (patch.visibility !== undefined) body.visibility = patch.visibility === 'public' ? 'public' : patch.visibility === 'private' ? 'private' : 'default';
      if (patch.attendees !== undefined) body.attendees = patch.attendees.map(a => ({ email: a.email, displayName: a.displayName }));
      if (patch.recurrence !== undefined) body.recurrence = patch.recurrence?.rrule ? [patch.recurrence.rrule] : [];
      if (patch.reminders !== undefined) body.reminders = patch.reminders ? { useDefault: false, overrides: patch.reminders.map(r => ({ method: r.method, minutes: r.minutes })) } : { useDefault: false };

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
        {
          method: 'PATCH',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to update event: ${response.statusText}`);
      }

      const event = await response.json();
      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', calendarId).items[0];
    },

    delete: async (token, calendarId, id, _options) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token.accessToken}` },
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete event: ${response.statusText}`);
      }
    },

    move: async (token, eventId, sourceCalendarId, targetCalendarId) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(sourceCalendarId)}/events/${encodeURIComponent(eventId)}/move`,
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ destination: targetCalendarId }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to move event: ${response.statusText}`);
      }

      const event = await response.json();
      return mapEventsResponse({ items: [event], kind: '', etag: '' }, '', '', targetCalendarId).items[0];
    },

    duplicate: async (token, eventId, targetCalendarId) => {
      const getResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events/${encodeURIComponent(eventId)}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!getResponse.ok) {
        throw new Error(`Failed to get event for duplication: ${getResponse.statusText}`);
      }

      const event = await getResponse.json();
      delete event.id;
      delete event.etag;
      delete event.htmlLink;
      delete event.created;
      delete event.updated;

      const createResponse = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCalendarId)}/events`,
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(event),
        }
      );

      if (!createResponse.ok) {
        throw new Error(`Failed to duplicate event: ${createResponse.statusText}`);
      }

      const newEvent = await createResponse.json();
      return mapEventsResponse({ items: [newEvent], kind: '', etag: '' }, '', '', targetCalendarId).items[0];
    },

    expandRecurrence: async (token, calendarId, eventId, timeMin, timeMax) => {
      const params = new URLSearchParams({
        singleEvents: 'true',
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
      });

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}/instances?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to expand recurrence: ${response.statusText}`);
      }

      const data: GoogleEventsResponse = await response.json();
      return data.items.map((e): ExpandedOccurrence => ({
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
        status: e.status === 'confirmed' ? 'confirmed' : e.status === 'tentative' ? 'tentative' : 'cancelled',
        location: e.location,
        recurrenceException: false,
      }));
    },
  };

  const availability: AvailabilityProviderMethods = {
    freeBusy: async (token, query) => {
      const response = await fetch(
        'https://www.googleapis.com/calendar/v3/freeBusy',
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            timeMin: query.timeMin.toISOString(),
            timeMax: query.timeMax.toISOString(),
            timeZone: query.timezone || 'UTC',
            items: query.calendars.map(id => ({ id })),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to get free/busy: ${response.statusText}`);
      }

      const data: GoogleFreeBusy = await response.json();
      const result: Record<string, Array<{ start: Date; end: Date; status: 'free' | 'busy' | 'tentative' | 'unknown' }>> = {};

      for (const [calId, calData] of Object.entries(data.calendars)) {
        result[calId] = (calData.busy || []).map(b => ({
          start: new Date(b.start),
          end: new Date(b.end),
          status: 'busy' as const,
        }));
      }

      return { calendars: result, timezone: data.timeZone };
    },

    suggestMeeting: async () => {
      throw new Error('Meeting time suggestions not supported by Google Calendar');
    },
  };

  const sync: SyncProviderMethods = {
    fullSync: async (token, calendarId, options) => {
      const params = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: 'false',
      });
      if (options?.timeMin) params.set('timeMin', options.timeMin.toISOString());
      if (options?.timeMax) params.set('timeMax', options.timeMax.toISOString());
      if (options?.limit) params.set('maxResults', String(options.limit));

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to full sync: ${response.statusText}`);
      }

      const data: GoogleEventsResponse = await response.json();
      const mapped = mapEventsResponse(data, '', '', calendarId);

      return {
        accountId: '',
        scope: 'events' as const,
        events: mapped.items.map(e => ({
          type: 'created' as const,
          event: e,
        })),
        deletions: [],
        nextCursor: mapped.nextSyncToken ? { token: mapped.nextSyncToken, expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } : undefined,
        expiredToken: false,
        hasMore: !!mapped.nextPageToken,
      } as SyncResult;
    },

    incrementalSync: async (token, calendarId, cursor) => {
      const params = new URLSearchParams({
        singleEvents: 'true',
        showDeleted: 'true',
        syncToken: cursor.token,
      });

      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (response.status === 410) {
        return {
          accountId: '',
          scope: 'events' as const,
          events: [],
          deletions: [],
          expiredToken: true,
          hasMore: false,
        } as SyncResult;
      }

      if (!response.ok) {
        throw new Error(`Failed to incremental sync: ${response.statusText}`);
      }

      const data: GoogleEventsResponse = await response.json();
      const mapped = mapEventsResponse(data, '', '', calendarId);

      const events: Array<{ type: 'created' | 'updated' | 'deleted'; event?: any; eventId?: string }> = [];

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
        nextCursor: mapped.nextSyncToken ? { token: mapped.nextSyncToken, expiry: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } : undefined,
        expiredToken: false,
        hasMore: !!mapped.nextPageToken,
      } as SyncResult;
    },
  };

  const subscriptions: SubscriptionsProviderMethods = {
    create: async (token, config) => {
      const response = await fetch(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(config.resource)}/watch`,
        {
          method: 'POST',
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            id: crypto.randomUUID(),
            type: 'web_hook',
            address: config.webhookUrl,
            expiration: config.leaseDurationSeconds 
              ? String(Date.now() + config.leaseDurationSeconds * 1000) 
              : String(Date.now() + 7 * 24 * 60 * 60 * 1000),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to create subscription: ${response.statusText}`);
      }

      const data: GoogleWatchResponse = await response.json();
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

    renew: async (token, subscriptionId) => {
      throw new Error('Google watch renewal requires recreating the channel');
    },

    delete: async (token, subscriptionId) => {
      await fetch('https://www.googleapis.com/calendar/v3/channels/stop', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ id: subscriptionId }),
      });
    },

    list: async (token, _accountId) => {
      return [];
    },

    get: async (_token, _subscriptionId) => {
      throw new Error('Get subscription not supported');
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
      calendars: { create: true, update: true, delete: true, share: true, manageNotifications: true },
      events: { list: true, create: true, update: true, delete: true, move: true, duplicate: true, attachments: true, conferenceData: true },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: false },
    }),
    createTransport: () => {
      const baseUrl = 'https://www.googleapis.com/calendar/v3';
      return {
        request: async <T>(options: { method?: string; path: string; query?: Record<string, string>; headers?: Record<string, string>; body?: unknown }) => {
          const params = new URLSearchParams(options.query || {});
          const url = `${baseUrl}${options.path}?${params}`;
          const response = await fetch(url, {
            method: options.method || 'GET',
            headers: options.headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
          });
          return { data: await response.json() as T, status: response.status, headers: {} };
        },
      };
    },
  };
}

function mapAccessRole(role: string): 'owner' | 'writer' | 'reader' | 'freeBusyReader' | 'none' {
  switch (role) {
    case 'owner': return 'owner';
    case 'writer': return 'writer';
    case 'reader': return 'reader';
    case 'freeBusyReader': return 'freeBusyReader';
    default: return 'none';
  }
}
