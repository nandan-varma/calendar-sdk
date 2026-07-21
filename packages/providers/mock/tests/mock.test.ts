import { describe, expect, it } from 'vitest';
import { createCalendarSdk } from '@calendar-sdk/core';
import { createMockProvider } from '../src/index.js';

describe('mock provider - full SDK flow without network calls', () => {
  it('connects an account, syncs calendars, and creates events', async () => {
    const sdk = createCalendarSdk({
      providers: [createMockProvider()],
    });

    const account = await sdk.accounts.connect('mock', {
      authInput: { authorizationCode: 'unused' },
    });
    expect(account.provider).toBe('mock');

    const calendars = await sdk.calendars.list(account.id);
    expect(calendars).toHaveLength(1);
    expect(calendars[0].primary).toBe(true);

    const event = await sdk.events.create(calendars[0].id, {
      title: 'Standup',
      start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2026-08-01T10:15:00Z', timezone: 'UTC' },
    });
    expect(event.title).toBe('Standup');

    const events = await sdk.events.list(calendars[0].id, {
      timeMin: new Date('2026-08-01T00:00:00Z'),
      timeMax: new Date('2026-08-02T00:00:00Z'),
    });
    expect(events.map((e) => e.id)).toContain(event.id);
  });

  it('computes free/busy from real stored events', async () => {
    const sdk = createCalendarSdk({ providers: [createMockProvider()] });
    const account = await sdk.accounts.connect('mock', {
      authInput: { authorizationCode: 'unused' },
    });
    const [calendar] = await sdk.calendars.list(account.id);

    await sdk.events.create(calendar.id, {
      title: 'Busy block',
      start: { dateTime: '2026-08-01T09:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
    });

    const freeBusy = await sdk.availability.freeBusy(account.id, {
      timeMin: new Date('2026-08-01T00:00:00Z'),
      timeMax: new Date('2026-08-02T00:00:00Z'),
      calendars: [calendar.providerId],
    });

    expect(freeBusy.calendars[calendar.providerId]).toHaveLength(1);
  });

  it('shares a calendar without throwing when the capability is supported', async () => {
    const sdk = createCalendarSdk({ providers: [createMockProvider()] });
    const account = await sdk.accounts.connect('mock', {
      authInput: { authorizationCode: 'unused' },
    });
    const [calendar] = await sdk.calendars.list(account.id);

    await expect(
      sdk.calendars.share(calendar.id, { email: 'teammate@example.com', role: 'reader' })
    ).resolves.toBeUndefined();
  });

  it('tracks incremental sync via a version cursor', async () => {
    const sdk = createCalendarSdk({ providers: [createMockProvider()] });
    const account = await sdk.accounts.connect('mock', {
      authInput: { authorizationCode: 'unused' },
    });
    const [calendar] = await sdk.calendars.list(account.id);

    const full = await sdk.sync.fullSync(account.id, { calendarId: calendar.id });
    expect(full.nextCursor).toBeDefined();

    await sdk.events.create(calendar.id, {
      title: 'New after cursor',
      start: { dateTime: '2026-08-03T09:00:00Z', timezone: 'UTC' },
      end: { dateTime: '2026-08-03T09:30:00Z', timezone: 'UTC' },
    });

    const incremental = await sdk.sync.incrementalSync(account.id, full.nextCursor!);
    expect(incremental.events).toHaveLength(1);
    expect(incremental.events[0].type).toBe('created');
  });
});
