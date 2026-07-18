import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TokenSet } from '@nandan-varma/calendar-sdk';
import { createCalDavProvider } from '../src/index.js';

function xmlResponse(body: string, status = 207) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/xml' }),
    text: () => Promise.resolve(body),
  };
}

const TOKEN: TokenSet = { accessToken: 'ignored-by-caldav' };
const NO_RETRY = { maxRetries: 0, initialDelayMs: 0, maxDelayMs: 0, backoffMultiplier: 1 };
const expectedAuthHeader = `Basic ${Buffer.from('ada@example.com:secret').toString('base64')}`;

describe('createCalDavProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  function provider() {
    return createCalDavProvider({
      serverUrl: 'https://caldav.example.com',
      username: 'ada@example.com',
      password: 'secret',
      fetch: fetchMock as unknown as typeof fetch,
      retryOptions: NO_RETRY,
    });
  }

  beforeEach(() => {
    fetchMock = vi.fn();
  });

  describe('auth', () => {
    it('has no code-exchange concept - it materializes Basic auth credentials directly', async () => {
      const tokens = await provider().auth.exchangeCode('ignored', 'ignored');
      expect(tokens.tokenType).toBe('Basic');
      expect(tokens.accessToken).toBe(Buffer.from('ada@example.com:secret').toString('base64'));
    });
  });

  describe('accounts.getAccount', () => {
    it('reports the configured username as the account identity', async () => {
      const account = await provider().accounts.getAccount(TOKEN);
      expect(account.provider).toBe('caldav');
      expect(account.email).toBe('ada@example.com');
      expect(account.capabilities.calendars.share).toBe(false);
    });
  });

  describe('calendars.list', () => {
    it('sends Basic auth on every request (regression: this was previously never attached)', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('<multistatus/>'));

      await provider().calendars.list(TOKEN);

      const [, init] = fetchMock.mock.calls[0];
      expect(init.headers.Authorization).toBe(expectedAuthHeader);
    });

    it('issues a PROPFIND request against the server root', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('<multistatus/>'));

      await provider().calendars.list(TOKEN);

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('https://caldav.example.com');
      expect(init.method).toBe('PROPFIND');
      expect(init.body).toContain('<D:propfind');
    });

    it('parses calendar hrefs out of the multistatus response', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse(
        '<D:multistatus><D:response><D:href>/calendars/ada/work/</D:href></D:response></D:multistatus>'
      ));

      const result = await provider().calendars.list(TOKEN);

      expect(result.items).toHaveLength(1);
      expect(result.items[0].providerId).toBe('/calendars/ada/work/');
      expect(result.items[0].primary).toBe(true);
    });
  });

  describe('events', () => {
    const icsEvent = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:evt-1',
      'SUMMARY:Standup',
      'DTSTART:20260801T100000Z',
      'DTEND:20260801T101500Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');

    it('issues a REPORT calendar-query with a time-range filter', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('<multistatus/>'));

      await provider().events.list(TOKEN, '/calendars/ada/work/', {
        timeMin: new Date('2026-08-01T00:00:00Z'),
        timeMax: new Date('2026-08-02T00:00:00Z'),
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe('/calendars/ada/work/');
      expect(init.method).toBe('REPORT');
      expect(init.body).toContain('time-range start="2026-08-01T00:00:00.000Z"');
    });

    it('parses events out of calendar-data blocks in the REPORT response', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse(
        `<D:multistatus><D:response><C:calendar-data>${icsEvent}</C:calendar-data></D:response></D:multistatus>`
      ));

      const result = await provider().events.list(TOKEN, '/calendars/ada/work/');

      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('Standup');
      expect(result.items[0].providerId).toBe('evt-1');
    });

    it('creates an event by PUTting a generated .ics document', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('', 201));

      const created = await provider().events.create(TOKEN, '/calendars/ada/work/', {
        title: 'Standup',
        start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2026-08-01T10:15:00Z', timezone: 'UTC' },
      });

      const [url, init] = fetchMock.mock.calls[0];
      expect(init.method).toBe('PUT');
      expect(url).toMatch(/^\/calendars\/ada\/work\/.*\.ics$/);
      expect(init.body).toContain('SUMMARY:Standup');
      expect(created.title).toBe('Standup');
    });

    it('round-trips all-day events through DTSTART/DTEND date-only values', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('', 201));

      const created = await provider().events.create(TOKEN, '/calendars/ada/work/', {
        title: 'Holiday',
        allDay: true,
        start: { date: '2026-08-01' },
        end: { date: '2026-08-02' },
      });

      const [, init] = fetchMock.mock.calls[0];
      expect(init.body).toContain('DTSTART:20260801');
      expect(created.allDay).toBe(true);
    });

    it('deletes an event and tolerates 404 as a successful no-op', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('not found', 404));

      await expect(provider().events.delete(TOKEN, '/calendars/ada/work/', 'evt-1')).resolves.toBeUndefined();
    });

    it('throws CAPABILITY_UNSUPPORTED for move/duplicate/expandRecurrence', async () => {
      await expect(provider().events.move(TOKEN, 'evt-1', 'a', 'b')).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
      await expect(provider().events.duplicate(TOKEN, 'evt-1', 'b')).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
      await expect(provider().events.expandRecurrence(TOKEN, 'cal', 'evt-1', new Date(), new Date())).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    });
  });

  describe('availability.freeBusy', () => {
    it('gracefully returns an empty array for a calendar whose free-busy REPORT fails', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('server error', 500));

      const result = await provider().availability.freeBusy(TOKEN, {
        timeMin: new Date(),
        timeMax: new Date(),
        calendars: ['/calendars/ada/work/'],
      });

      expect(result.calendars['/calendars/ada/work/']).toEqual([]);
    });
  });

  describe('sync', () => {
    it('fullSync delegates to events.list for the calendar', async () => {
      fetchMock.mockResolvedValueOnce(xmlResponse('<multistatus/>'));

      const result = await provider().sync.fullSync(TOKEN, '/calendars/ada/work/');

      expect(result.events).toEqual([]);
      expect(result.hasMore).toBe(false);
    });

    it('throws CAPABILITY_UNSUPPORTED for incremental sync', async () => {
      await expect(provider().sync.incrementalSync(TOKEN, 'cal', {} as never)).rejects.toMatchObject({
        code: 'CAPABILITY_UNSUPPORTED',
      });
    });
  });

  describe('subscriptions', () => {
    it('throws CAPABILITY_UNSUPPORTED for every webhook operation', async () => {
      await expect(provider().subscriptions.create(TOKEN, {} as never)).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
      await expect(provider().subscriptions.renew(TOKEN, 'id')).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
      await expect(provider().subscriptions.delete(TOKEN, 'id')).rejects.toMatchObject({ code: 'CAPABILITY_UNSUPPORTED' });
    });
  });

  describe('getCapabilities', () => {
    it('reports no sharing, webhook, or incremental sync support', () => {
      const caps = provider().getCapabilities();
      expect(caps.calendars.share).toBe(false);
      expect(caps.sync.webhook).toBe(false);
      expect(caps.sync.incremental).toBe(false);
    });
  });
});
