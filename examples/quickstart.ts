// Runnable end-to-end walkthrough - no credentials or network access required.
// Run with: pnpm --filter @nandan-varma/calendar-sdk-examples quickstart
//
// Swap createMockProvider() for createGoogleProvider()/createMicrosoftProvider()/createCalDavProvider()
// and every call below stays identical - see google-oauth.ts for the real-credentials version.

import { createCalendarSdk } from '@nandan-varma/calendar-sdk';
import { createMockProvider } from '@nandan-varma/calendar-sdk-mock';

const sdk = createCalendarSdk({
  providers: [createMockProvider()],
});

const account = await sdk.accounts.connect('mock', {
  authInput: { authorizationCode: 'unused-by-the-mock-provider' },
});
console.log(`Connected account: ${account.email} (${account.id})`);

const calendars = await sdk.calendars.list(account.id);
console.log(`Calendars: ${calendars.map(c => c.name).join(', ')}`);

const [primary] = calendars;

const event = await sdk.events.create(primary.id, {
  title: 'Coffee',
  start: { dateTime: '2026-08-01T10:00:00Z', timezone: 'UTC' },
  end: { dateTime: '2026-08-01T10:30:00Z', timezone: 'UTC' },
});
console.log(`Created event: "${event.title}" at ${event.start.dateTime}`);

const events = await sdk.events.list(primary.id, {
  timeMin: new Date('2026-08-01T00:00:00Z'),
  timeMax: new Date('2026-08-02T00:00:00Z'),
});
console.log(`Events in range: ${events.length}`);

const freeBusy = await sdk.availability.freeBusy(account.id, {
  timeMin: new Date('2026-08-01T00:00:00Z'),
  timeMax: new Date('2026-08-02T00:00:00Z'),
  calendars: [primary.providerId],
});
console.log(`Busy blocks on ${primary.name}: ${freeBusy.calendars[primary.providerId]?.length ?? 0}`);

await sdk.calendars.share(primary.id, { email: 'teammate@example.com', role: 'reader' });
console.log('Shared the calendar with teammate@example.com');
