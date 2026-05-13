import { describe, expect, it } from 'vitest';

import {
  CalendarSdkError,
  createCalendarSdk,
  createLogger,
  createMemoryStorage,
  errors,
  getCapabilitiesForProvider,
} from '../src/index.js';

describe('basic SDK behavior', () => {
  it('creates with empty providers', () => {
    const sdk = createCalendarSdk({
      storage: createMemoryStorage(),
      logger: createLogger({ minLevel: 'error' }),
      providers: [],
    });

    expect(sdk).not.toBeNull();
    expect(typeof sdk.accounts.list).toBe('function');
  });

  it('storage adapter works', async () => {
    const storage = createMemoryStorage();

    const account = {
      id: 'test-1',
      provider: 'google',
      displayName: 'Test User',
      email: 'test@example.com',
      status: 'connected',
      capabilities: getCapabilitiesForProvider('google'),
      raw: {},
      extensions: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await storage.accounts.save(account);
    const retrieved = await storage.accounts.get('test-1');

    expect(retrieved?.id).toBe('test-1');
  });

  it('creates typed errors', () => {
    const error = new CalendarSdkError({
      code: 'AUTH_REQUIRED',
      message: 'Auth required',
      provider: 'google',
      retryable: false,
    });

    expect(error.code).toBe('AUTH_REQUIRED');
    expect(error.provider).toBe('google');
    expect(error.retryable).toBe(false);
  });

  it('error factory functions work', () => {
    const err = errors.notFound('google', 'Calendar not found');

    expect(err.code).toBe('NOT_FOUND');
    expect(err.message).toBe('Calendar not found');
  });

  it('capability detection works', () => {
    const caps = getCapabilitiesForProvider('google');
    expect(caps.events.create).toBe(true);
    expect(caps.sync.incremental).toBe(true);
    expect(caps.sync.webhook).toBe(true);

    const microsoftCaps = getCapabilitiesForProvider('microsoft');
    expect(microsoftCaps.availability.suggestedTimes).toBe(true);

    const caldavCaps = getCapabilitiesForProvider('caldav');
    expect(caldavCaps.calendars.create).toBe(true);
  });

  it('error has required properties', () => {
    const err = errors.authRequired('google');

    expect(err.code).toBe('AUTH_REQUIRED');
    expect(err.provider).toBe('google');
    expect(err.message.length).toBeGreaterThan(0);
  });
});
