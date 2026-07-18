import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenSet } from '@nandan-varma/calendar-sdk';
import { createMicrosoftProvider } from '../src/index.js';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

const TOKEN: TokenSet = { accessToken: 'access-123' };
const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 };

describe('createMicrosoftProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function provider() {
    return createMicrosoftProvider({
      clientId: 'client-id',
      clientSecret: 'client-secret',
      fetch: fetchMock as unknown as typeof fetch,
      retryOptions: NO_RETRY,
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  describe('auth', () => {
    it('builds the authorization URL against the configured tenant', async () => {
      const p = createMicrosoftProvider({
        clientId: 'client-id',
        tenantId: 'contoso',
        fetch: fetchMock as unknown as typeof fetch,
      });

      const url = await p.auth.createAuthorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://app.example.com/callback',
        scope: ['Calendars.ReadWrite'],
      });

      expect(url).toContain('https://login.microsoftonline.com/contoso/oauth2/v2.0/authorize');
    });

    it('defaults to the "common" tenant when none is configured', async () => {
      const url = await provider().auth.createAuthorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://app.example.com/callback',
        scope: ['Calendars.ReadWrite'],
      });

      expect(url).toContain('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    });

    it('exchanges a code for a token set', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        token_type: 'Bearer',
        scope: 'Calendars.ReadWrite offline_access',
      }));

      const tokens = await provider().auth.exchangeCode('auth-code', 'https://app.example.com/callback');

      expect(tokens.accessToken).toBe('new-access');
      expect(tokens.scope).toEqual(['Calendars.ReadWrite', 'offline_access']);
    });

    it('is a no-op for revokeToken (Microsoft has no revocation endpoint)', async () => {
      await expect(provider().auth.revokeToken('access-123')).resolves.toBeUndefined();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe('accounts.getAccount', () => {
    it('falls back to userPrincipalName when mail is absent', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        id: 'user-1',
        displayName: 'Ada Lovelace',
        userPrincipalName: 'ada@contoso.onmicrosoft.com',
      }));

      const account = await provider().accounts.getAccount(TOKEN);

      expect(account.provider).toBe('microsoft');
      expect(account.email).toBe('ada@contoso.onmicrosoft.com');
    });
  });

  describe('calendars', () => {
    it('lists calendars from the me/calendars endpoint', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        value: [{ id: 'cal-1', name: 'Calendar', isDefaultCalendar: true }],
      }));

      const result = await provider().calendars.list(TOKEN);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].primary).toBe(true);
    });

    it('deletes a calendar and tolerates 404 as a successful no-op', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

      await expect(provider().calendars.delete(TOKEN, 'cal-1')).resolves.toBeUndefined();
    });

    it('shares a calendar via calendarPermissions, mapping the access role to a Graph role', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'perm-1', role: 'write' }));

      await provider().calendars.share!(TOKEN, 'cal-1', { email: 'ada@example.com', role: 'writer' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/calendars/cal-1/calendarPermissions');
      expect(JSON.parse(init.body)).toEqual({ emailAddress: { address: 'ada@example.com' }, role: 'write' });
    });

    it('maps freeBusyReader to Graph\'s freeBusyRead role', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'perm-1' }));

      await provider().calendars.share!(TOKEN, 'cal-1', { email: 'ada@example.com', role: 'freeBusyReader' });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).role).toBe('freeBusyRead');
    });
  });

  describe('events.list (calendarView regression)', () => {
    it('uses GET with startDateTime/endDateTime as query params, not POST with a body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await provider().events.list(TOKEN, 'cal-1', {
        timeMin: new Date('2026-08-01T00:00:00Z'),
        timeMax: new Date('2026-08-02T00:00:00Z'),
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method ?? 'GET').toBe('GET');
      expect(init.body).toBeUndefined();
      expect(url).toContain('startDateTime=2026-08-01T00%3A00%3A00.000Z');
      expect(url).toContain('endDateTime=2026-08-02T00%3A00%3A00.000Z');
      expect(url).toContain('/me/calendars/cal-1/calendarView');
    });

    it('does not crash building the request (regression for the removed Date.prototype.toTimezoneOffset call)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await expect(provider().events.list(TOKEN, 'cal-1', {})).resolves.toEqual({ items: [], nextPageToken: undefined });
    });

    it('maps returned events to the canonical shape', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        value: [{
          id: 'evt-1',
          subject: 'Standup',
          start: { dateTime: '2026-08-01T10:00:00.0000000', timeZone: 'UTC' },
          end: { dateTime: '2026-08-01T10:15:00.0000000', timeZone: 'UTC' },
          createdDateTime: '2026-07-01T00:00:00Z',
          lastModifiedDateTime: '2026-07-01T00:00:00Z',
        }],
      }));

      const result = await provider().events.list(TOKEN, 'cal-1', {});

      expect(result.items[0].title).toBe('Standup');
    });
  });

  describe('events', () => {
    it('creates an event with the mapped request body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        id: 'evt-1',
        subject: 'Standup',
        start: { dateTime: '2026-08-01T10:00:00Z', timeZone: 'UTC' },
        end: { dateTime: '2026-08-01T10:15:00Z', timeZone: 'UTC' },
        createdDateTime: '2026-07-01T00:00:00Z',
        lastModifiedDateTime: '2026-07-01T00:00:00Z',
      }));

      await provider().events.create(TOKEN, 'cal-1', {
        title: 'Standup',
        start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2026-08-01T10:15:00Z', timezone: 'UTC' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://graph.microsoft.com/v1.0/me/calendars/cal-1/events');
      expect(JSON.parse(init.body).subject).toBe('Standup');
    });

    it('throws CAPABILITY_UNSUPPORTED for move (not supported by Graph)', async () => {
      await expect(provider().events.move(TOKEN, 'evt-1', 'cal-1', 'cal-2')).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });

    it('throws CAPABILITY_UNSUPPORTED for duplicate (not supported by Graph)', async () => {
      await expect(provider().events.duplicate(TOKEN, 'evt-1', 'cal-2')).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });

    it('deletes an event and tolerates 404 as a successful no-op', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 404));

      await expect(provider().events.delete(TOKEN, 'cal-1', 'evt-1')).resolves.toBeUndefined();
    });
  });

  describe('availability', () => {
    it('computes free/busy from getSchedule', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        value: [{
          scheduleId: 'ada@example.com',
          scheduleItems: [{ status: 'busy', start: { dateTime: '2026-08-01T09:00:00' }, end: { dateTime: '2026-08-01T10:00:00' } }],
        }],
      }));

      const result = await provider().availability.freeBusy(TOKEN, {
        timeMin: new Date('2026-08-01T00:00:00Z'),
        timeMax: new Date('2026-08-02T00:00:00Z'),
        calendars: ['ada@example.com'],
      });

      expect(result.calendars['ada@example.com']).toHaveLength(1);
      expect(result.calendars['ada@example.com'][0].status).toBe('busy');
    });

    it('suggests meeting times via findMeetingTimes', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        meetingTimeSuggestions: [{
          meetingTimeSlot: { start: { dateTime: '2026-08-01T09:00:00' } },
          confidence: 100,
          organizerAvailability: 'free',
        }],
      }));

      const result = await provider().availability.suggestMeeting(TOKEN, {
        timeMin: new Date(),
        timeMax: new Date(),
        meetingDuration: 30,
        attendees: ['ada@example.com'],
      });

      expect(result.meetingSuggestions).toHaveLength(1);
    });
  });

  describe('sync', () => {
    it('throws CAPABILITY_UNSUPPORTED for incremental sync (delta query not implemented)', async () => {
      await expect(provider().sync.incrementalSync(TOKEN, 'cal-1', {} as never)).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });

    it('full syncs via calendarView with GET, not POST', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ value: [] }));

      await provider().sync.fullSync(TOKEN, 'cal-1');

      const [, init] = fetchMock.mock.calls[0];
      expect(init.method ?? 'GET').toBe('GET');
    });
  });

  describe('subscriptions', () => {
    it('creates a change-notification subscription', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({
        id: 'sub-1',
        expirationDateTime: new Date(Date.now() + 3600_000).toISOString(),
        resource: 'me/events',
      }));

      const sub = await provider().subscriptions.create(TOKEN, { resource: 'me/events', webhookUrl: 'https://app.example.com/hook' });

      expect(sub.id).toBe('sub-1');
      expect(sub.status).toBe('active');
    });
  });
});
