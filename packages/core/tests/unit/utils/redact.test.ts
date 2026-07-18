import { describe, it, expect } from 'vitest';
import { redactSensitive } from '../../../src/utils/redact.js';

describe('redactSensitive', () => {
  it('returns non-object, non-string values unchanged', () => {
    expect(redactSensitive(undefined)).toBeUndefined();
    expect(redactSensitive(null)).toBeNull();
    expect(redactSensitive(42)).toBe(42);
  });

  it('redacts sensitive keys in a plain object, recursively', () => {
    const result = redactSensitive({
      accessToken: 'abc',
      nested: { refresh_token: 'def', title: 'Team sync' },
      title: 'Coffee',
    });

    expect(result).toEqual({
      accessToken: '[REDACTED]',
      nested: { refresh_token: '[REDACTED]', title: 'Team sync' },
      title: 'Coffee',
    });
  });

  it('redacts sensitive keys in an array of objects', () => {
    const result = redactSensitive([{ password: 'x' }, { title: 'y' }]);
    expect(result).toEqual([{ password: '[REDACTED]' }, { title: 'y' }]);
  });

  it('redacts sensitive fields in a urlencoded string body without touching the rest', () => {
    const body = new URLSearchParams({
      client_secret: 'shh',
      client_id: 'public',
      code: 'one-time-code',
      grant_type: 'authorization_code',
    }).toString();

    const result = redactSensitive(body) as string;
    const parsed = new URLSearchParams(result);

    expect(parsed.get('client_secret')).toBe('[REDACTED]');
    expect(parsed.get('code')).toBe('[REDACTED]');
    expect(parsed.get('client_id')).toBe('public');
    expect(parsed.get('grant_type')).toBe('authorization_code');
  });

  it('does not redact unrelated fields that merely contain "code" as a substring', () => {
    const result = redactSensitive({ providerErrorCode: 'invalidGrant', statusCode: 404 });
    expect(result).toEqual({ providerErrorCode: 'invalidGrant', statusCode: 404 });
  });

  it('leaves non-form-encoded strings (e.g. XML/iCalendar bodies) unchanged', () => {
    const xml = '<propfind><prop/></propfind>';
    expect(redactSensitive(xml)).toBe(xml);
  });
});
