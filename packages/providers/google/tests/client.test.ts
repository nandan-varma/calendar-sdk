import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenSet } from '@nandan-varma/calendar-sdk';
import { createGoogleProvider } from '../src/client.js';

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

function textResponse(body: string, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'text/plain' }),
    text: () => Promise.resolve(body),
    json: () => Promise.reject(new Error('not json')),
  };
}

const TOKEN: TokenSet = { accessToken: 'access-123' };
const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 };

describe('createGoogleProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function provider() {
    return createGoogleProvider({
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
    it('builds the authorization URL with the requested scopes and offline access', async () => {
      const url = await provider().auth.createAuthorizationUrl({
        clientId: 'client-id',
        redirectUri: 'https://app.example.com/callback',
        scope: ['https://www.googleapis.com/auth/calendar'],
        accessType: 'offline',
        prompt: 'consent',
      });

      const parsed = new URL(url);
      expect(parsed.origin + parsed.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
      expect(parsed.searchParams.get('scope')).toBe('https://www.googleapis.com/auth/calendar');
      expect(parsed.searchParams.get('access_type')).toBe('offline');
      expect(parsed.searchParams.get('prompt')).toBe('consent');
    });

    it('exchanges a code for a token set', async () => {
      const before = Date.now();
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          access_token: 'new-access',
          refresh_token: 'new-refresh',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar',
        })
      );

      const tokens = await provider().auth.exchangeCode(
        'auth-code',
        'https://app.example.com/callback'
      );

      expect(tokens.accessToken).toBe('new-access');
      expect(tokens.refreshToken).toBe('new-refresh');
      expect(tokens.scope).toEqual(['https://www.googleapis.com/auth/calendar']);
      // Google's real token endpoint returns `expires_in` (relative seconds), not an absolute
      // `expiry_date` - assert the computed expiresAt actually lands ~1hr out, not Invalid Date.
      expect(tokens.expiresAt).toBeInstanceOf(Date);
      expect(tokens.expiresAt!.getTime()).toBeGreaterThanOrEqual(before + 3600_000);
      expect(tokens.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/token');
      expect(init.headers['Content-Type']).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(init.body);
      expect(body.get('code')).toBe('auth-code');
      expect(body.get('grant_type')).toBe('authorization_code');
    });

    it('refreshes a token, preserving the original refresh token', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          access_token: 'rotated-access',
          expires_in: 3600,
          token_type: 'Bearer',
          scope: 'https://www.googleapis.com/auth/calendar',
        })
      );

      const tokens = await provider().auth.refreshToken({ refreshToken: 'existing-refresh' });

      expect(tokens.accessToken).toBe('rotated-access');
      expect(tokens.refreshToken).toBe('existing-refresh');
      expect(tokens.expiresAt).toBeInstanceOf(Date);
      expect(Number.isNaN(tokens.expiresAt!.getTime())).toBe(false);

      const [, init] = fetchMock.mock.calls[0];
      const body = new URLSearchParams(init.body);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('existing-refresh');
    });

    it('revokes a token', async () => {
      fetchMock.mockResolvedValueOnce(textResponse(''));

      await provider().auth.revokeToken('access-123');

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://oauth2.googleapis.com/revoke');
      expect(init.body).toContain('token=access-123');
    });
  });

  describe('accounts.getAccount', () => {
    it('maps the userinfo response to a canonical Account', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'plus#person',
          id: 'user-1',
          email: 'ada@example.com',
          name: 'Ada Lovelace',
        })
      );

      const account = await provider().accounts.getAccount(TOKEN);

      expect(account.provider).toBe('google');
      expect(account.email).toBe('ada@example.com');
      expect(account.displayName).toBe('Ada Lovelace');
      expect(account.capabilities.calendars.share).toBe(true);

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe('Bearer access-123');
    });
  });

  describe('calendars', () => {
    it('lists calendars and maps access role to capabilities', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'calendar#calendarList',
          etag: 'x',
          items: [
            {
              kind: 'x',
              etag: 'x',
              id: 'cal-1',
              summary: 'Primary',
              accessRole: 'owner',
              selected: true,
            },
            {
              kind: 'x',
              etag: 'x',
              id: 'cal-2',
              summary: 'Team',
              accessRole: 'reader',
              selected: false,
            },
          ],
        })
      );

      const result = await provider().calendars.list(TOKEN);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].capabilities.delete).toBe(true);
      expect(result.items[1].capabilities.delete).toBe(false);
      expect(result.items[1].readOnly).toBe(true);
    });

    it('creates a calendar with the mapped request body', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ id: 'new-cal', summary: 'Team events', timeZone: 'UTC' })
      );

      await provider().calendars.create(TOKEN, { name: 'Team events', timezone: 'UTC' });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/users/me/calendars');
      expect(JSON.parse(init.body)).toMatchObject({ summary: 'Team events', timeZone: 'UTC' });
    });

    it('deletes a calendar and tolerates 404 as a successful no-op', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'not found' }, 404));

      await expect(provider().calendars.delete(TOKEN, 'cal-1')).resolves.toBeUndefined();
    });

    it('shares a calendar via the ACL insert endpoint', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'user:ada@example.com', role: 'reader' }));

      await provider().calendars.share!(TOKEN, 'cal-1', {
        email: 'ada@example.com',
        role: 'reader',
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal-1/acl');
      expect(JSON.parse(init.body)).toEqual({
        role: 'reader',
        scope: { type: 'user', value: 'ada@example.com' },
      });
    });
  });

  describe('events', () => {
    const googleEvent = {
      kind: 'calendar#event',
      etag: 'etag-1',
      id: 'evt-1',
      status: 'confirmed',
      summary: 'Standup',
      start: { dateTime: '2026-08-01T10:00:00Z', timeZone: 'UTC' },
      end: { dateTime: '2026-08-01T10:15:00Z', timeZone: 'UTC' },
    };

    it('lists events for a calendar within a time range', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ kind: 'x', etag: 'x', items: [googleEvent] }));

      const result = await provider().events.list(TOKEN, 'cal-1', {
        timeMin: new Date('2026-08-01T00:00:00Z'),
        timeMax: new Date('2026-08-02T00:00:00Z'),
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Standup');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toContain('timeMin=2026-08-01T00%3A00%3A00.000Z');
    });

    it('creates a timed event with the mapped request body', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(googleEvent));

      await provider().events.create(TOKEN, 'cal-1', {
        title: 'Standup',
        start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2026-08-01T10:15:00Z', timezone: 'UTC' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://www.googleapis.com/calendar/v3/calendars/cal-1/events');
      const body = JSON.parse(init.body);
      expect(body.summary).toBe('Standup');
      expect(body.start).toEqual({ dateTime: '2026-08-01T10:00:00Z', timeZone: 'UTC' });
    });

    it('creates an all-day event using the date field, not dateTime', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(googleEvent));

      await provider().events.create(TOKEN, 'cal-1', {
        title: 'Holiday',
        allDay: true,
        start: { date: '2026-08-01' },
        end: { date: '2026-08-02' },
      });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body.start).toEqual({ date: '2026-08-01' });
      expect(body.end).toEqual({ date: '2026-08-02' });
    });

    it('only includes patched fields on update', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(googleEvent));

      await provider().events.update(TOKEN, 'cal-1', 'evt-1', { title: 'Renamed' });

      const [, init] = fetchMock.mock.calls[0];
      const body = JSON.parse(init.body);
      expect(body).toEqual({ summary: 'Renamed' });
    });

    it('deletes an event and tolerates 404 as a successful no-op', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'gone' }, 404));

      await expect(provider().events.delete(TOKEN, 'cal-1', 'evt-1')).resolves.toBeUndefined();
    });

    it('moves an event to another calendar via the destination query param', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse(googleEvent));

      await provider().events.move(TOKEN, 'evt-1', 'cal-1', 'cal-2');

      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe(
        'https://www.googleapis.com/calendar/v3/calendars/cal-1/events/evt-1/move?destination=cal-2'
      );
    });

    it('duplicates an event by cloning the source payload without identity fields', async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({ ...googleEvent, htmlLink: 'x', created: 'x', updated: 'x' })
        )
        .mockResolvedValueOnce(jsonResponse({ ...googleEvent, id: 'evt-2' }));

      await provider().events.duplicate(TOKEN, 'evt-1', 'cal-2');

      const [, createInit] = fetchMock.mock.calls[1];
      const clonedBody = JSON.parse(createInit.body);
      expect(clonedBody.id).toBeUndefined();
      expect(clonedBody.etag).toBeUndefined();
      expect(clonedBody.htmlLink).toBeUndefined();
      expect(clonedBody.created).toBeUndefined();
      expect(clonedBody.updated).toBeUndefined();
    });
  });

  describe('availability', () => {
    it('computes free/busy from the vendor response', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'x',
          timeZone: 'UTC',
          calendars: {
            'cal-1': { busy: [{ start: '2026-08-01T09:00:00Z', end: '2026-08-01T10:00:00Z' }] },
          },
        })
      );

      const result = await provider().availability.freeBusy(TOKEN, {
        timeMin: new Date('2026-08-01T00:00:00Z'),
        timeMax: new Date('2026-08-02T00:00:00Z'),
        calendars: ['cal-1'],
      });

      expect(result.calendars['cal-1']).toHaveLength(1);
      expect(result.calendars['cal-1'][0].status).toBe('busy');
    });

    it('throws CAPABILITY_UNSUPPORTED for meeting suggestions', async () => {
      await expect(provider().availability.suggestMeeting({} as never)).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });
  });

  describe('sync', () => {
    it('full syncs events and returns a syncToken-based cursor', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'x',
          etag: 'x',
          items: [
            {
              kind: 'x',
              etag: 'x',
              id: 'evt-1',
              status: 'confirmed',
              summary: 'Standup',
              start: { dateTime: '2026-08-01T10:00:00Z' },
              end: { dateTime: '2026-08-01T10:15:00Z' },
            },
          ],
          nextSyncToken: 'sync-token-1',
        })
      );

      const result = await provider().sync.fullSync(TOKEN, 'cal-1');

      expect(result.events).toHaveLength(1);
      expect(result.nextCursor?.token).toBe('sync-token-1');
    });

    it('treats a 410 response as an expired cursor instead of throwing', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({ error: { code: 410, message: 'Sync token is no longer valid' } }, 410)
      );

      const result = await provider().sync.incrementalSync(TOKEN, 'cal-1', {
        id: 'x',
        provider: 'google',
        accountId: 'a',
        scope: 'events',
        token: 'old-token',
        expiry: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(result.expiredToken).toBe(true);
    });

    it('maps a cancelled event to a deletion in incremental sync', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'x',
          etag: 'x',
          items: [{ kind: 'x', etag: 'x', id: 'evt-1', status: 'cancelled' }],
        })
      );

      const result = await provider().sync.incrementalSync(TOKEN, 'cal-1', {
        id: 'x',
        provider: 'google',
        accountId: 'a',
        scope: 'events',
        token: 'sync-token',
        expiry: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      expect(result.events).toEqual([{ type: 'deleted', eventId: 'evt-1' }]);
    });
  });

  describe('subscriptions', () => {
    it('creates a watch channel', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'api#channel',
          channelId: 'channel-1',
          resourceId: 'res-1',
          resourceUri: 'https://x',
          expiration: String(Date.now() + 3600_000),
        })
      );

      const sub = await provider().subscriptions.create(TOKEN, {
        resource: 'cal-1',
        webhookUrl: 'https://app.example.com/hook',
      });

      expect(sub.id).toBe('channel-1');
      expect(sub.status).toBe('active');
    });

    it('throws CAPABILITY_UNSUPPORTED for renew (channels must be recreated)', async () => {
      await expect(provider().subscriptions.renew(TOKEN, 'channel-1')).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });

    it('forwards a configured secret as the watch channel token, so it can be verified later', async () => {
      fetchMock.mockResolvedValueOnce(
        jsonResponse({
          kind: 'api#channel',
          channelId: 'channel-1',
          resourceId: 'res-1',
          resourceUri: 'https://x',
          expiration: String(Date.now() + 3600_000),
        })
      );

      const sub = await provider().subscriptions.create(TOKEN, {
        resource: 'cal-1',
        webhookUrl: 'https://app.example.com/hook',
        secret: 'shh-its-a-secret',
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(JSON.parse(init.body).token).toBe('shh-its-a-secret');
      expect(sub.secret).toBe('shh-its-a-secret');
    });
  });

  describe('createTransport', () => {
    it('returns the same transport actually used by every other method (not a disconnected stub)', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));

      const p = provider();
      await p
        .createTransport()
        .request({ path: 'https://www.googleapis.com/calendar/v3/users/me' });

      expect(fetchMock).toHaveBeenCalledWith(
        'https://www.googleapis.com/calendar/v3/users/me',
        expect.any(Object)
      );
    });
  });
});
