import type { ProviderAdapter, TokenSet, RefreshToken, CreateAuthUrlOptions, ShareCalendarInput, RetryOptions } from '@nandan-varma/calendar-sdk';
import type { Logger } from '@nandan-varma/calendar-sdk';
import { CalendarSdkError, createTransport, defaultRetryOptions } from '@nandan-varma/calendar-sdk';

const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

export interface MicrosoftProviderConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  tenantId?: string;
  logger?: Logger;
  /** Bring your own fetch (proxying, instrumentation, test doubles, ...). */
  fetch?: typeof fetch;
  /** Overrides for the SDK's default retry/backoff policy. */
  retryOptions?: Partial<RetryOptions>;
}

export function createMicrosoftProvider(config: MicrosoftProviderConfig): ProviderAdapter {
  const tenantId = config.tenantId || 'common';
  const logger = config.logger;
  const retryOptions: RetryOptions = { ...defaultRetryOptions, ...config.retryOptions };
  const transport = createTransport('microsoft', { fetch: config.fetch, retryOptions }, logger);

  const authHeader = (token: TokenSet) => ({ Authorization: `Bearer ${token.accessToken}` });

  const auth = {
    createAuthorizationUrl: async (options: CreateAuthUrlOptions) => {
      const params = new URLSearchParams({
        client_id: options.clientId,
        redirect_uri: options.redirectUri || config.redirectUri || '',
        response_type: 'code',
        scope: options.scope.join(' '),
        response_mode: 'query',
        ...(options.state && { state: options.state }),
      });
      return `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`;
    },

    exchangeCode: async (code: string, redirectUri: string) => {
      const { data } = await transport.request<any>({
        method: 'POST',
        path: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
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
      const { data } = await transport.request<any>({
        method: 'POST',
        path: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
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
        refreshToken: data.refresh_token || token.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    revokeToken: async (_token: string) => {
      // Microsoft identity platform has no token revocation endpoint for confidential clients.
    },
  };

  const accounts = {
    getAccount: async (token: TokenSet) => {
      const { data: user } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me`,
        headers: authHeader(token),
      });

      return {
        id: user.id,
        provider: 'microsoft' as const,
        displayName: user.displayName || user.mail || user.userPrincipalName,
        email: user.mail || user.userPrincipalName,
        status: 'connected' as const,
        capabilities: {
          calendars: { create: true, update: true, delete: true, share: true, manageNotifications: false },
          events: { list: true, create: true, update: true, delete: true, move: true, duplicate: false, attachments: true, conferenceData: true },
          sync: { incremental: true, webhook: true, polling: true },
          availability: { freeBusy: true, suggestedTimes: true },
        },
        raw: user,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },
  };

  const calendars = {
    list: async (token: TokenSet, query?: { pageToken?: string; limit?: number }) => {
      const params: Record<string, string> = {};
      if (query?.limit) params.$top = String(query.limit);

      const { data } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me/calendars`,
        query: params,
        headers: authHeader(token),
      });

      return {
        items: data.value.map((cal: any) => ({
          id: cal.id,
          accountId: '',
          providerId: cal.id,
          name: cal.name,
          description: cal.description,
          timezone: cal.timeZone || 'UTC',
          color: cal.color,
          primary: cal.isDefaultCalendar ?? false,
          readOnly: false,
          hidden: false,
          accessRole: 'owner' as const,
          capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: false },
          raw: cal,
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        })),
        nextPageToken: data['@odata.nextLink'] ? 'next' : undefined,
      };
    },

    get: async (token: TokenSet, id: string) => {
      const { data: cal } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me/calendars/${id}`,
        headers: authHeader(token),
      });

      return {
        id: cal.id,
        accountId: '',
        providerId: cal.id,
        name: cal.name,
        description: cal.description,
        timezone: cal.timeZone || 'UTC',
        color: cal.color,
        primary: cal.isDefaultCalendar ?? false,
        readOnly: false,
        hidden: false,
        accessRole: 'owner' as const,
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: false },
        raw: cal,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    create: async (token: TokenSet, input: { name: string; description?: string; timezone?: string }) => {
      const { data: cal } = await transport.request<any>({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/me/calendars`,
        headers: authHeader(token),
        body: {
          name: input.name,
          description: input.description,
          color: 'auto',
        },
      });

      return {
        id: cal.id,
        accountId: '',
        providerId: cal.id,
        name: cal.name,
        description: cal.description,
        timezone: cal.timeZone || 'UTC',
        color: cal.color,
        primary: false,
        readOnly: false,
        hidden: false,
        accessRole: 'owner' as const,
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: false },
        raw: cal,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    update: async (token: TokenSet, id: string, patch: { name?: string; description?: string }) => {
      const { data: cal } = await transport.request<any>({
        method: 'PATCH',
        path: `${GRAPH_BASE_URL}/me/calendars/${id}`,
        headers: authHeader(token),
        body: patch,
      });

      return {
        id: cal.id,
        accountId: '',
        providerId: cal.id,
        name: cal.name,
        description: cal.description,
        timezone: cal.timeZone || 'UTC',
        color: cal.color,
        primary: cal.isDefaultCalendar ?? false,
        readOnly: false,
        hidden: false,
        accessRole: 'owner' as const,
        capabilities: { create: true, update: true, delete: true, share: true, manageNotifications: false },
        raw: cal,
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    delete: async (token: TokenSet, id: string) => {
      await deleteIgnoring404(() => transport.request({
        method: 'DELETE',
        path: `${GRAPH_BASE_URL}/me/calendars/${id}`,
        headers: authHeader(token),
        responseType: 'text',
      }));
    },

    // Microsoft Graph calendarPermissions: https://learn.microsoft.com/en-us/graph/api/calendar-post-calendarpermissions
    share: async (token: TokenSet, calendarId: string, input: ShareCalendarInput) => {
      await transport.request({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/calendarPermissions`,
        headers: authHeader(token),
        body: {
          emailAddress: { address: input.email },
          role: mapShareRole(input.role),
        },
      });
    },
  };

  const events = {
    list: async (token: TokenSet, calendarId: string, query?: { pageToken?: string; limit?: number; timeMin?: Date; timeMax?: Date; showDeleted?: boolean }) => {
      const params: Record<string, string> = {
        startDateTime: (query?.timeMin || new Date()).toISOString(),
        endDateTime: (query?.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).toISOString(),
      };
      if (query?.limit) params.$top = String(query.limit);

      const { data } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/calendarView`,
        query: params,
        headers: authHeader(token),
      });

      return {
        items: data.value.map((evt: any) => mapMicrosoftEvent(evt, calendarId)),
        nextPageToken: data['@odata.nextLink'] ? 'next' : undefined,
      };
    },

    get: async (token: TokenSet, calendarId: string, id: string) => {
      const { data: evt } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/events/${id}`,
        headers: authHeader(token),
      });

      return mapMicrosoftEvent(evt, calendarId);
    },

    create: async (token: TokenSet, calendarId: string, input: any, _options?: any) => {
      const body: any = {
        subject: input.title,
        body: { contentType: 'HTML', content: input.description || '' },
        location: input.location ? { displayName: input.location } : undefined,
        start: { dateTime: input.start.dateTime || input.start.date, timeZone: input.start.timezone || 'UTC' },
        end: { dateTime: input.end.dateTime || input.end.date, timeZone: input.end.timezone || 'UTC' },
        isAllDay: input.allDay ?? false,
        showAs: input.transparency === 'transparent' ? 'free' : 'busy',
        sensitivity: input.visibility === 'private' ? 'private' : 'normal',
      };

      if (input.attendees) {
        body.attendees = input.attendees.map((a: any) => ({
          emailAddress: { address: a.email, name: a.displayName },
          type: 'required',
        }));
      }
      if (input.recurrence?.rrule) {
        body.recurrence = parseRRuleToOutlook(input.recurrence.rrule);
      }

      const { data: evt } = await transport.request<any>({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/events`,
        headers: authHeader(token),
        body,
      });

      return mapMicrosoftEvent(evt, calendarId);
    },

    update: async (token: TokenSet, calendarId: string, id: string, patch: any, _options?: any) => {
      const body: any = {};
      if (patch.title !== undefined) body.subject = patch.title;
      if (patch.description !== undefined) body.body = { contentType: 'HTML', content: patch.description };
      if (patch.location !== undefined) body.location = { displayName: patch.location };
      if (patch.start !== undefined) body.start = { dateTime: patch.start.dateTime || patch.start.date, timeZone: patch.start.timezone || 'UTC' };
      if (patch.end !== undefined) body.end = { dateTime: patch.end.dateTime || patch.end.date, timeZone: patch.end.timezone || 'UTC' };

      const { data: evt } = await transport.request<any>({
        method: 'PATCH',
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/events/${id}`,
        headers: authHeader(token),
        body,
      });

      return mapMicrosoftEvent(evt, calendarId);
    },

    delete: async (token: TokenSet, calendarId: string, id: string, _options?: any) => {
      await deleteIgnoring404(() => transport.request({
        method: 'DELETE',
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/events/${id}`,
        headers: authHeader(token),
        responseType: 'text',
      }));
    },

    move: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Event move is not supported by Microsoft Graph',
        provider: 'microsoft',
      });
    },

    duplicate: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Event duplicate is not supported by Microsoft Graph',
        provider: 'microsoft',
      });
    },

    expandRecurrence: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Recurrence expansion is not supported by Microsoft Graph',
        provider: 'microsoft',
      });
    },
  };

  const availability = {
    freeBusy: async (token: TokenSet, query: { timeMin: Date; timeMax: Date; calendars: string[]; timezone?: string }) => {
      const { data } = await transport.request<any>({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/me/calendar/getSchedule`,
        headers: authHeader(token),
        body: {
          schedules: query.calendars,
          startTime: { dateTime: query.timeMin.toISOString(), timeZone: query.timezone || 'UTC' },
          endTime: { dateTime: query.timeMax.toISOString(), timeZone: query.timezone || 'UTC' },
        },
      });

      const result: Record<string, any[]> = {};
      for (const schedule of data.value || []) {
        result[schedule.scheduleId] = (schedule.scheduleItems || []).map((item: any) => ({
          start: new Date(item.start.dateTime),
          end: new Date(item.end.dateTime),
          status: item.status === 'free' ? 'free' : item.status === 'tentative' ? 'tentative' : 'busy',
        }));
      }

      return { calendars: result, timezone: query.timezone || 'UTC' };
    },

    suggestMeeting: async (token: TokenSet, query: { timeMin: Date; timeMax: Date; meetingDuration: number; attendees: string[] }) => {
      const { data } = await transport.request<any>({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/me/findMeetingTimes`,
        headers: authHeader(token),
        body: {
          attendees: query.attendees.map(a => ({ emailAddress: { address: a }, type: 'required' })),
          timeConstraint: {
            activityDomain: 'work',
            timeSlots: [{
              start: { dateTime: query.timeMin.toISOString(), timeZone: 'UTC' },
              end: { dateTime: query.timeMax.toISOString(), timeZone: 'UTC' },
            }],
          },
          meetingDuration: `PT${query.meetingDuration}M`,
        },
      });

      return {
        meetingSuggestions: (data.meetingTimeSuggestions || []).map((s: any) => ({
          meetingTime: new Date(s.meetingTimeSlot.start.dateTime),
          confidence: s.confidence || 1,
          organizerAvailability: s.organizerAvailability || 'busy',
          attendeeAvailability: {},
          meetingDuration: query.meetingDuration,
        })),
      };
    },
  };

  const sync = {
    fullSync: async (token: TokenSet, calendarId: string, options?: { timeMin?: Date; timeMax?: Date; limit?: number }) => {
      const params: Record<string, string> = {
        startDateTime: (options?.timeMin || new Date()).toISOString(),
        endDateTime: (options?.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)).toISOString(),
      };
      if (options?.limit) params.$top = String(options.limit);

      const { data } = await transport.request<any>({
        path: `${GRAPH_BASE_URL}/me/calendars/${calendarId}/calendarView`,
        query: params,
        headers: authHeader(token),
      });

      return {
        accountId: '',
        scope: 'events' as const,
        events: data.value.map((evt: any) => ({ type: 'created' as const, event: mapMicrosoftEvent(evt, calendarId) })),
        deletions: [],
        expiredToken: false,
        hasMore: !!data['@odata.nextLink'],
      };
    },

    incrementalSync: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Incremental sync requires Microsoft Graph delta query, which is not yet implemented',
        provider: 'microsoft',
      });
    },
  };

  const subscriptions = {
    create: async (token: TokenSet, config: { resource: string; webhookUrl?: string; leaseDurationSeconds?: number }) => {
      const { data } = await transport.request<{ id: string; expirationDateTime: string; resource: string }>({
        method: 'POST',
        path: `${GRAPH_BASE_URL}/subscriptions`,
        headers: authHeader(token),
        body: {
          changeType: 'created,updated,deleted',
          notificationUrl: config.webhookUrl,
          resource: config.resource,
          expirationDateTime: new Date(Date.now() + (config.leaseDurationSeconds || 4230) * 1000).toISOString(),
        },
      });

      return {
        id: data.id,
        accountId: '',
        provider: 'microsoft',
        resource: config.resource,
        webhookUrl: config.webhookUrl,
        leaseExpiry: new Date(data.expirationDateTime),
        renewalPolicy: 'auto' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    renew: async (token: TokenSet, subscriptionId: string) => {
      const { data } = await transport.request<{ id: string; expirationDateTime: string; resource: string }>({
        method: 'PATCH',
        path: `${GRAPH_BASE_URL}/subscriptions/${subscriptionId}`,
        headers: authHeader(token),
        body: { expirationDateTime: new Date(Date.now() + 4230 * 1000).toISOString() },
      });

      return {
        id: data.id,
        accountId: '',
        provider: 'microsoft',
        resource: data.resource,
        leaseExpiry: new Date(data.expirationDateTime),
        renewalPolicy: 'auto' as const,
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    },

    delete: async (token: TokenSet, subscriptionId: string) => {
      await transport.request({
        method: 'DELETE',
        path: `${GRAPH_BASE_URL}/subscriptions/${subscriptionId}`,
        headers: authHeader(token),
        responseType: 'text',
      });
    },

    list: async (_token: TokenSet, _accountId: string) => [],

    get: async () => {
      throw new CalendarSdkError({
        code: 'CAPABILITY_UNSUPPORTED',
        message: 'Fetching a single Microsoft Graph subscription by id is not implemented',
        provider: 'microsoft',
      });
    },
  };

  return {
    key: 'microsoft',
    displayName: 'Microsoft Outlook',
    auth,
    accounts,
    calendars,
    events,
    availability,
    sync,
    subscriptions,
    getCapabilities: () => ({
      calendars: { create: true, update: true, delete: true, share: true, manageNotifications: false },
      events: { list: true, create: true, update: true, delete: true, move: true, duplicate: false, attachments: true, conferenceData: true },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: true },
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

function mapShareRole(role: string): string {
  switch (role) {
    case 'owner':
    case 'writer':
      return 'write';
    case 'freeBusyReader':
      return 'freeBusyRead';
    default:
      return 'read';
  }
}

function mapMicrosoftEvent(evt: any, calendarId: string): any {
  return {
    id: evt.id,
    accountId: '',
    calendarId,
    providerId: evt.id,
    iCalUid: evt.iCalUId,
    title: evt.subject,
    description: evt.body?.content,
    location: evt.location?.displayName,
    start: { dateTime: evt.start.dateTime, timezone: evt.start.timeZone },
    end: { dateTime: evt.end.dateTime, timezone: evt.end.timeZone },
    allDay: evt.isAllDay ?? false,
    timezone: evt.originalStartTimeZone || 'UTC',
    status: evt.showAs === 'free' ? 'confirmed' : evt.showAs === 'tentative' ? 'tentative' : 'confirmed',
    transparency: evt.showAs === 'free' ? 'transparent' : 'opaque',
    visibility: evt.sensitivity === 'private' ? 'private' : 'default',
    attendees: (evt.attendees || []).map((a: any) => ({
      email: a.emailAddress.address,
      displayName: a.emailAddress.name,
      responseStatus: a.status?.response || 'none',
    })),
    organizer: evt.organizer ? { email: evt.organizer.emailAddress.address, displayName: evt.organizer.emailAddress.name } : undefined,
    reminders: evt.isReminderOn ? [{ method: 'popup' as const, minutes: evt.reminderMinutesBeforeStart || 15 }] : undefined,
    recurrence: evt.recurrence ? { rrule: '' } : undefined,
    recurrenceMaster: !evt.seriesMasterId,
    recurringEventId: evt.seriesMasterId,
    exceptions: [],
    conference: undefined,
    attachments: [],
    raw: evt,
    extensions: {},
    createdAt: new Date(evt.createdDateTime),
    updatedAt: new Date(evt.lastModifiedDateTime),
  };
}

function parseRRuleToOutlook(_rrule: string): any {
  return { pattern: { type: 'daily' }, range: { type: 'numbered', numberOfOccurrences: 10 } };
}
