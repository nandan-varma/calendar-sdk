import type { ProviderAdapter, TokenSet, RefreshToken, CreateAuthUrlOptions } from '@calendar-sdk/core';

export interface MicrosoftProviderConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  tenantId?: string;
}

export function createMicrosoftProvider(config: MicrosoftProviderConfig): ProviderAdapter {
  const tenantId = config.tenantId || 'common';

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
      const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    refreshToken: async (token: RefreshToken) => {
      const response = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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

      const data = await response.json();
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token || token.refreshToken,
        expiresAt: new Date(Date.now() + data.expires_in * 1000),
        tokenType: data.token_type,
        scope: data.scope.split(' '),
      };
    },

    revokeToken: async (_token: string) => {
      // Microsoft doesn't have a revoke endpoint
    },
  };

  const accounts = {
    getAccount: async (token: TokenSet) => {
      const response = await fetch('https://graph.microsoft.com/v1.0/me', {
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });

      if (!response.ok) {
        throw new Error('Failed to get account info');
      }

      const user = await response.json();
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
      const params = new URLSearchParams();
      if (query?.limit) params.set('$top', String(query.limit));

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars?${params}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to list calendars: ${response.statusText}`);
      }

      const data = await response.json();
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
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${id}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to get calendar: ${response.statusText}`);
      }

      const cal = await response.json();
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
      const response = await fetch('https://graph.microsoft.com/v1.0/me/calendars', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: input.name,
          description: input.description,
          color: 'auto',
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create calendar: ${response.statusText}`);
      }

      const cal = await response.json();
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
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${id}`, {
        method: 'PATCH',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(patch),
      });

      if (!response.ok) {
        throw new Error(`Failed to update calendar: ${response.statusText}`);
      }

      const cal = await response.json();
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
      const response = await fetch(`https://graph.microsoft.com/v1.0/me/calendars/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete calendar: ${response.statusText}`);
      }
    },
  };

  const events = {
    list: async (token: TokenSet, calendarId: string, query?: { pageToken?: string; limit?: number; timeMin?: Date; timeMax?: Date; showDeleted?: boolean }) => {
      const params = new URLSearchParams();
      if (query?.limit) params.set('$top', String(query.limit));

      const startDate = query?.timeMin || new Date();
      const endDate = query?.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?${params}`,
        { 
          headers: { 
            Authorization: `Bearer ${token.accessToken}`,
            'Content-Type': 'application/json',
            Prefer: `outlook.timezone="${startDate.toTimezoneOffset()}"`,
          },
          method: 'POST',
          body: JSON.stringify({
            startDateTime: startDate.toISOString(),
            endDateTime: endDate.toISOString(),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to list events: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        items: data.value.map((evt: any) => mapMicrosoftEvent(evt, calendarId)),
        nextPageToken: data['@odata.nextLink'] ? 'next' : undefined,
      };
    },

    get: async (token: TokenSet, calendarId: string, id: string) => {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${id}`,
        { headers: { Authorization: `Bearer ${token.accessToken}` } }
      );

      if (!response.ok) {
        throw new Error(`Failed to get event: ${response.statusText}`);
      }

      const evt = await response.json();
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

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events`,
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

      const evt = await response.json();
      return mapMicrosoftEvent(evt, calendarId);
    },

    update: async (token: TokenSet, calendarId: string, id: string, patch: any, _options?: any) => {
      const body: any = {};
      if (patch.title !== undefined) body.subject = patch.title;
      if (patch.description !== undefined) body.body = { contentType: 'HTML', content: patch.description };
      if (patch.location !== undefined) body.location = { displayName: patch.location };
      if (patch.start !== undefined) body.start = { dateTime: patch.start.dateTime || patch.start.date, timeZone: patch.start.timezone || 'UTC' };
      if (patch.end !== undefined) body.end = { dateTime: patch.end.dateTime || patch.end.date, timeZone: patch.end.timezone || 'UTC' };

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${id}`,
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

      const evt = await response.json();
      return mapMicrosoftEvent(evt, calendarId);
    },

    delete: async (token: TokenSet, calendarId: string, id: string, _options?: any) => {
      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/events/${id}`,
        {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token.accessToken}` },
        }
      );

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete event: ${response.statusText}`);
      }
    },

    move: async (_token: TokenSet, _eventId: string, _sourceCalendarId: string, _targetCalendarId: string) => {
      throw new Error('Event move not supported by Microsoft Graph');
    },

    duplicate: async (_token: TokenSet, _eventId: string, _targetCalendarId: string) => {
      throw new Error('Event duplicate not supported by Microsoft Graph');
    },

    expandRecurrence: async (_token: TokenSet, _calendarId: string, _eventId: string, _timeMin: Date, _timeMax: Date) => {
      throw new Error('Recurrence expansion not supported by Microsoft Graph');
    },
  };

  const availability = {
    freeBusy: async (token: TokenSet, query: { timeMin: Date; timeMax: Date; calendars: string[]; timezone?: string }) => {
      const response = await fetch('https://graph.microsoft.com/v1.0/me/calendar/getSchedule', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          schedules: query.calendars,
          startTime: { dateTime: query.timeMin.toISOString(), timeZone: query.timezone || 'UTC' },
          endTime: { dateTime: query.timeMax.toISOString(), timeZone: query.timezone || 'UTC' },
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to get free/busy: ${response.statusText}`);
      }

      const data = await response.json();
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
      const response = await fetch('https://graph.microsoft.com/v1.0/me/findMeetingTimes', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          attendees: query.attendees.map(a => ({ emailAddress: { address: a }, type: 'required' })),
          timeConstraint: {
            activityDomain: 'work',
            timeSlots: [{
              start: { dateTime: query.timeMin.toISOString(), timeZone: 'UTC' },
              end: { dateTime: query.timeMax.toISOString(), timeZone: 'UTC' },
            }],
          },
          meetingDuration: `PT${query.meetingDuration}M`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to suggest meeting times: ${response.statusText}`);
      }

      const data = await response.json();
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
      const params = new URLSearchParams();
      if (options?.limit) params.set('$top', String(options.limit));

      const startDate = options?.timeMin || new Date();
      const endDate = options?.timeMax || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      const response = await fetch(
        `https://graph.microsoft.com/v1.0/me/calendars/${calendarId}/calendarView?${params}`,
        { 
          headers: { Authorization: `Bearer ${token.accessToken}`, 'Content-Type': 'application/json' },
          method: 'POST',
          body: JSON.stringify({
            startDateTime: startDate.toISOString(),
            endDateTime: endDate.toISOString(),
          }),
        }
      );

      if (!response.ok) {
        throw new Error(`Failed to full sync: ${response.statusText}`);
      }

      const data = await response.json();
      return {
        accountId: '',
        scope: 'events' as const,
        events: data.value.map((evt: any) => ({ type: 'created' as const, event: mapMicrosoftEvent(evt, calendarId) })),
        deletions: [],
        expiredToken: false,
        hasMore: !!data['@odata.nextLink'],
      };
    },

    incrementalSync: async (_token: TokenSet, _calendarId: string, _cursor: any) => {
      throw new Error('Incremental sync requires delta query implementation');
    },
  };

  const subscriptions = {
    create: async (token: TokenSet, config: { resource: string; webhookUrl?: string; leaseDurationSeconds?: number }) => {
      const response = await fetch('https://graph.microsoft.com/v1.0/subscriptions', {
        method: 'POST',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          changeType: 'created,updated,deleted',
          notificationUrl: config.webhookUrl,
          resource: config.resource,
          expirationDateTime: new Date(Date.now() + (config.leaseDurationSeconds || 4230) * 1000).toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to create subscription: ${response.statusText}`);
      }

      const data = await response.json() as { id: string; expirationDateTime: string; resource: string };
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
      const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
        method: 'PATCH',
        headers: { 
          Authorization: `Bearer ${token.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          expirationDateTime: new Date(Date.now() + 4230 * 1000).toISOString(),
        }),
      });

      if (!response.ok) {
        throw new Error(`Failed to renew subscription: ${response.statusText}`);
      }

      const data = await response.json() as { id: string; expirationDateTime: string; resource: string };
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
      const response = await fetch(`https://graph.microsoft.com/v1.0/subscriptions/${subscriptionId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token.accessToken}` },
      });

      if (!response.ok && response.status !== 404) {
        throw new Error(`Failed to delete subscription: ${response.statusText}`);
      }
    },

    list: async (_token: TokenSet, _accountId: string) => [],
    get: async (_token: TokenSet, _subscriptionId: string) => { throw new Error('Not implemented'); },
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
    createTransport: () => ({
      request: async <T>(options: any) => {
        const response = await fetch(`https://graph.microsoft.com/v1.0${options.path}`, {
          method: options.method || 'GET',
          headers: options.headers,
          body: options.body ? JSON.stringify(options.body) : undefined,
        });
        return { data: await response.json() as T, status: response.status, headers: {} };
      },
    }),
  };
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

function parseRRuleToOutlook(rrule: string): any {
  return { pattern: { type: 'daily' }, range: { type: 'numbered', numberOfOccurrences: 10 } };
}

declare global {
  interface Date {
    toTimezoneOffset(): string;
  }
}
