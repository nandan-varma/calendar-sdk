import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { ProviderAdapter, TokenSet } from '../../src/types/index.js';
import type { Calendar, CalendarEvent } from '../../src/types/index.js';
import { loadGoogleProvider, clearProviderCache } from '../helpers/providers.js';
import { hasGoogleCredentials, testEnv } from '../helpers/env.js';

const TEST_PREFIX = '__TEST_GOOGLE__';

describe.skipIf(!hasGoogleCredentials())('Google Calendar Integration', () => {
  let provider: ProviderAdapter;
  let token: TokenSet;
  let testCalendar: Calendar | null = null;
  let testEvent: CalendarEvent | null = null;
  let testCalendarsCreated: string[] = [];

  beforeAll(async () => {
    const testProvider = await loadGoogleProvider();
    provider = testProvider.adapter;
    token = testProvider.token;
  });

  afterAll(async () => {
    // Clean up test calendar if created
    if (testCalendar && token) {
      try {
        console.log(`\n🧹 Cleaning up: Deleting test calendar "${testCalendar.name}"`);
        await provider.calendars.delete(token, testCalendar.providerId);
        console.log('✅ Calendar deleted');
      } catch (e: any) {
        console.warn(`⚠️  Failed to delete test calendar: ${e.message}`);
      }
    }

    // Clean up any additional test calendars
    for (const calId of testCalendarsCreated) {
      try {
        await provider.calendars.delete(token, calId);
      } catch (e) {
        // Ignore
      }
    }
  });

  describe('Account', () => {
    it('should get account info', async () => {
      const account = await provider.accounts.getAccount(token);

      expect(account).toBeDefined();
      expect(account.provider).toBe('google');
      expect(account.email).toBeDefined();
      expect(account.capabilities).toBeDefined();
      console.log(`   ✅ Account: ${account.email}`);
    });
  });

  describe('Calendars', () => {
    it('should list calendars', async () => {
      const result = await provider.calendars.list(token);

      expect(result.items).toBeDefined();
      expect(result.items.length).toBeGreaterThan(0);
      console.log(`   ✅ Found ${result.items.length} calendars`);
    });

    it('should create a test calendar', async () => {
      const timestamp = Date.now();
      const calendarName = `${TEST_PREFIX}${timestamp}`;

      const calendar = await provider.calendars.create(token, {
        name: calendarName,
        description: 'Test calendar created by calendar-sdk integration tests',
      });

      expect(calendar).toBeDefined();
      expect(calendar.name).toBe(calendarName);
      expect(calendar.providerId).toBeDefined();

      testCalendar = calendar;
      testCalendarsCreated.push(calendar.providerId);

      console.log(`   ✅ Created calendar: ${calendarName} (${calendar.providerId})`);
    });

    it('should get the created calendar', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const calendar = await provider.calendars.get(token, testCalendar.providerId);

      expect(calendar).toBeDefined();
      expect(calendar?.name).toBe(testCalendar.name);
      console.log(`   ✅ Retrieved calendar: ${calendar?.name}`);
    });

    it('should update the test calendar', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const updated = await provider.calendars.update(token, testCalendar.providerId, {
        description: 'Updated by integration test',
      });

      expect(updated.description).toBe('Updated by integration test');
      console.log(`   ✅ Updated calendar description`);
    });
  });

  describe('Events', () => {
    const eventTimestamp = Date.now();

    it('should list events from test calendar', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const result = await provider.events.list(token, testCalendar.providerId);

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      console.log(`   ✅ Listed events in calendar`);
    });

    it('should create an event in test calendar', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const startTime = new Date(Date.now() + 24 * 60 * 60 * 1000); // Tomorrow
      const endTime = new Date(startTime.getTime() + 60 * 60 * 1000); // 1 hour later

      const event = await provider.events.create(token, testCalendar.providerId, {
        title: `TEST: Integration Test Event ${eventTimestamp}`,
        description: 'This is a test event created by calendar-sdk integration tests',
        location: 'Test Location',
        start: { dateTime: startTime.toISOString(), timezone: 'UTC' },
        end: { dateTime: endTime.toISOString(), timezone: 'UTC' },
        status: 'confirmed',
        reminders: [{ method: 'popup', minutes: 30 }],
      });

      expect(event).toBeDefined();
      expect(event.title).toContain('TEST: Integration Test Event');
      expect(event.providerId).toBeDefined();

      testEvent = event;
      console.log(`   ✅ Created event: ${event.title} (${event.providerId})`);
    });

    it('should get the created event', async () => {
      if (!testCalendar || !testEvent) {
        console.log('   ⚠️  Skipped - no test event');
        return;
      }

      const event = await provider.events.get(token, testCalendar.providerId, testEvent.providerId);

      expect(event).toBeDefined();
      expect(event?.title).toBe(testEvent.title);
      console.log(`   ✅ Retrieved event: ${event?.title}`);
    });

    it('should update the event', async () => {
      if (!testCalendar || !testEvent) {
        console.log('   ⚠️  Skipped - no test event');
        return;
      }

      const updated = await provider.events.update(
        token,
        testCalendar.providerId,
        testEvent.providerId,
        {
          description: 'Updated description by integration test',
        }
      );

      expect(updated.description).toBe('Updated description by integration test');
      console.log(`   ✅ Updated event description`);
    });

    it('should delete the event', async () => {
      if (!testCalendar || !testEvent) {
        console.log('   ⚠️  Skipped - no test event');
        return;
      }

      await provider.events.delete(token, testCalendar.providerId, testEvent.providerId);

      // Verify deleted
      try {
        await provider.events.get(token, testCalendar.providerId, testEvent.providerId);
        throw new Error('Event should have been deleted');
      } catch (e: any) {
        expect(e.message).toContain('Failed to get event');
      }

      console.log(`   ✅ Deleted event`);
      testEvent = null;
    });
  });

  describe('Availability', () => {
    it('should query free/busy', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const now = new Date();
      const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const result = await provider.availability.freeBusy(token, {
        timeMin: now,
        timeMax: end,
        calendars: ['primary'],
        timezone: 'UTC',
      });

      expect(result).toBeDefined();
      expect(result.calendars).toBeDefined();
      console.log(`   ✅ Queried free/busy`);
    });
  });

  describe('Sync', () => {
    it('should perform full sync', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      const now = new Date();
      const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

      const result = await provider.sync.fullSync(token, testCalendar.providerId, {
        timeMin: now,
        timeMax: end,
        limit: 100,
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result.events)).toBe(true);
      expect(typeof result.hasMore).toBe('boolean');
      console.log(`   ✅ Full sync completed, ${result.events.length} events`);
    });
  });

  describe('Delete Calendar', () => {
    it('should delete the test calendar', async () => {
      if (!testCalendar) {
        console.log('   ⚠️  Skipped - no test calendar');
        return;
      }

      await provider.calendars.delete(token, testCalendar.providerId);

      testCalendarsCreated = testCalendarsCreated.filter((id) => id !== testCalendar?.providerId);

      console.log(`   ✅ Deleted test calendar: ${testCalendar.name}`);
      testCalendar = null;
    });
  });
});
