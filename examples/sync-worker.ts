// Demonstrates the full-sync -> persist cursor -> incremental-sync loop a background
// worker would run on a schedule to keep local state current.
// Run with: pnpm --filter @nandan-varma/calendar-sdk-examples sync-worker

import { createCalendarSdk } from '@nandan-varma/calendar-sdk';
import { createMockProvider } from '@nandan-varma/calendar-sdk-mock';

const sdk = createCalendarSdk({ providers: [createMockProvider()] });

const account = await sdk.accounts.connect('mock', {
  authInput: { authorizationCode: 'unused-by-the-mock-provider' },
});
const [calendar] = await sdk.calendars.list(account.id);

// 1. First run: full sync seeds local storage and returns a cursor to persist
// (in a real worker, save `cursor` next to the account - e.g. in your database - not in memory).
let { nextCursor: cursor } = await sdk.sync.fullSync(account.id, { calendarId: calendar.id });
console.log(`Full sync complete. Cursor token: ${cursor?.token}`);

// 2. Something changes upstream between polling intervals...
await sdk.events.create(calendar.id, {
  title: 'New meeting',
  start: { dateTime: '2026-08-05T14:00:00Z', timezone: 'UTC' },
  end: { dateTime: '2026-08-05T14:30:00Z', timezone: 'UTC' },
});

// 3. Next poll: incremental sync only fetches what changed since the last cursor.
if (cursor) {
  const result = await sdk.sync.incrementalSync(account.id, cursor);
  console.log(`Incremental sync picked up ${result.events.length} change(s):`);
  for (const change of result.events) {
    console.log(`  - ${change.type}: ${change.type === 'deleted' ? change.eventId : change.event.title}`);
  }
  cursor = result.nextCursor ?? cursor;
}

console.log(`Next cursor token to persist: ${cursor?.token}`);
