import { describe, it, expect, vi } from 'vitest';
import { createTransport } from '../../../src/transport/index.js';

describe('Transport request options', () => {
  it('sends string bodies as-is without JSON-encoding them', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/xml' }),
      text: () => Promise.resolve('<ok/>'),
    });

    const transport = createTransport('caldav', { fetch: fetchMock as any });
    const xml = '<propfind><prop/></propfind>';

    await transport.request({ method: 'PROPFIND', path: '/', body: xml, responseType: 'text' });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(xml);
  });

  it('does not default Content-Type to JSON for string bodies', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/xml' }),
      text: () => Promise.resolve('<ok/>'),
    });

    const transport = createTransport('caldav', { fetch: fetchMock as any });

    await transport.request({
      method: 'PROPFIND',
      path: '/',
      headers: { 'Content-Type': 'application/xml' },
      body: '<propfind/>',
      responseType: 'text',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['Content-Type']).toBe('application/xml');
  });

  it('JSON-serializes object bodies and defaults Content-Type only when unset', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ ok: true }),
    });

    const transport = createTransport('google', { fetch: fetchMock as any });

    await transport.request({ method: 'POST', path: '/events', body: { title: 'Test' } });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.body).toBe(JSON.stringify({ title: 'Test' }));
    expect(init.headers['Content-Type']).toBe('application/json');
  });

  it('supports custom HTTP methods like REPORT/PROPFIND', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/xml' }),
      text: () => Promise.resolve('<multistatus/>'),
    });

    const transport = createTransport('caldav', { fetch: fetchMock as any });

    await transport.request({
      method: 'REPORT',
      path: '/calendar',
      body: '<query/>',
      responseType: 'text',
    });

    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('REPORT');
  });

  it('parses successful responses as text when responseType is "text"', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'text/calendar' }),
      text: () => Promise.resolve('BEGIN:VCALENDAR\nEND:VCALENDAR'),
    });

    const transport = createTransport('caldav', { fetch: fetchMock as any });

    const result = await transport.request<string>({ path: '/event.ics', responseType: 'text' });

    expect(result.data).toBe('BEGIN:VCALENDAR\nEND:VCALENDAR');
  });

  it('still parses JSON by default when responseType is omitted', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'application/json' }),
      json: () => Promise.resolve({ items: [] }),
    });

    const transport = createTransport('google', { fetch: fetchMock as any });

    const result = await transport.request({ path: '/calendars' });

    expect(result.data).toEqual({ items: [] });
  });

  it('204 responses are always null regardless of responseType', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      headers: new Headers(),
      text: () => Promise.resolve(''),
    });

    const transport = createTransport('caldav', { fetch: fetchMock as any });

    const result = await transport.request({
      method: 'DELETE',
      path: '/event.ics',
      responseType: 'text',
    });

    expect(result.data).toBeNull();
  });

  describe('debug logging cost', () => {
    const fetchMock = () =>
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ ok: true }),
      });

    it('skips building the request debug log (with its expensive redaction) when the logger reports debug is disabled', async () => {
      const debug = vi.fn();
      const logger = {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isLevelEnabled: () => false,
      };

      const transport = createTransport('google', { fetch: fetchMock() }, logger);
      await transport.request({ path: '/test', body: { secret: 'do-not-touch' } });

      const requestLogCalls = debug.mock.calls.filter(([, meta]) => meta && 'body' in meta);
      expect(requestLogCalls).toHaveLength(0);
    });

    it('still logs request details (redacted body/headers included) when the logger reports debug is enabled', async () => {
      const debug = vi.fn();
      const logger = {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isLevelEnabled: () => true,
      };

      const transport = createTransport('google', { fetch: fetchMock() }, logger);
      await transport.request({ path: '/test', body: { title: 'Test' } });

      const requestLogCalls = debug.mock.calls.filter(([, meta]) => meta && 'body' in meta);
      expect(requestLogCalls).toHaveLength(1);
    });

    it('defaults to logging when the logger does not implement isLevelEnabled (custom/bridged loggers)', async () => {
      const debug = vi.fn();
      const logger = { debug, info: vi.fn(), warn: vi.fn(), error: vi.fn() };

      const transport = createTransport('google', { fetch: fetchMock() }, logger);
      await transport.request({ path: '/test', body: { title: 'Test' } });

      const requestLogCalls = debug.mock.calls.filter(([, meta]) => meta && 'body' in meta);
      expect(requestLogCalls).toHaveLength(1);
    });

    it('redacts secrets in urlencoded string bodies (OAuth token exchange), not just JSON objects', async () => {
      const debug = vi.fn();
      const logger = {
        debug,
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        isLevelEnabled: () => true,
      };

      const transport = createTransport('google', { fetch: fetchMock() }, logger);
      const body = new URLSearchParams({
        code: 'auth-code-value',
        client_id: 'public-client-id',
        client_secret: 'super-secret-value',
        refresh_token: 'refresh-token-value',
        grant_type: 'authorization_code',
      }).toString();

      await transport.request({ method: 'POST', path: '/token', body });

      const [, loggedMeta] = debug.mock.calls.find(([, meta]) => meta && 'body' in meta)!;
      const loggedBody = String(loggedMeta.body);

      expect(loggedBody).not.toContain('super-secret-value');
      expect(loggedBody).not.toContain('refresh-token-value');
      expect(loggedBody).not.toContain('auth-code-value');
      // Non-sensitive fields survive so the log is still useful for debugging.
      expect(loggedBody).toContain('public-client-id');
      expect(loggedBody).toContain('grant_type=authorization_code');
    });
  });
});
