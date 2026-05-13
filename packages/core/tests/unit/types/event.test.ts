import { describe, it, expect } from 'vitest';
import type { CalendarEvent, CreateEventInput, UpdateEventInput, Attendee } from '../../../src/types/event.js';

describe('Event Types', () => {
  describe('CalendarEvent', () => {
    it('should have required fields', () => {
      const event: CalendarEvent = {
        id: 'event-1',
        accountId: 'account-1',
        calendarId: 'calendar-1',
        providerId: 'provider-event-1',
        title: 'Test Event',
        start: { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00Z', timezone: 'UTC' },
        allDay: false,
        timezone: 'UTC',
        status: 'confirmed',
        transparency: 'opaque',
        visibility: 'default',
        attendees: [],
        recurrenceMaster: true,
        exceptions: [],
        attachments: [],
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(event.id).toBe('event-1');
      expect(event.title).toBe('Test Event');
      expect(event.status).toBe('confirmed');
      expect(event.recurrenceMaster).toBe(true);
    });

    it('should support optional fields', () => {
      const event: CalendarEvent = {
        id: 'event-1',
        accountId: 'account-1',
        calendarId: 'calendar-1',
        providerId: 'provider-event-1',
        title: 'Test Event',
        description: 'Event description',
        location: 'Conference Room A',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' },
        allDay: true,
        timezone: 'America/Los_Angeles',
        status: 'tentative',
        transparency: 'transparent',
        visibility: 'private',
        attendees: [
          {
            email: 'attendee@example.com',
            displayName: 'Attendee',
            responseStatus: 'accepted',
          },
        ],
        organizer: {
          email: 'organizer@example.com',
          displayName: 'Organizer',
          self: true,
        },
        reminders: [{ method: 'popup', minutes: 30 }],
        recurrence: { rrule: 'FREQ=DAILY;COUNT=5' },
        recurrenceMaster: false,
        recurringEventId: 'master-event-id',
        exceptions: [],
        conference: {
          provider: 'google',
          conferenceId: 'meet-123',
          entryPoints: [{ entryPointType: 'video', uri: 'https://meet.google.com/abc' }],
        },
        attachments: [],
        etag: '"abc123"',
        version: '1',
        raw: { originalData: true },
        extensions: { customField: 'value' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(event.allDay).toBe(true);
      expect(event.description).toBe('Event description');
      expect(event.attendees).toHaveLength(1);
      expect(event.organizer?.self).toBe(true);
      expect(event.recurrence).toBeDefined();
      expect(event.conference?.provider).toBe('google');
    });

    it('should support deleted events', () => {
      const event: CalendarEvent = {
        id: 'event-1',
        accountId: 'account-1',
        calendarId: 'calendar-1',
        providerId: 'provider-event-1',
        title: 'Deleted Event',
        start: { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00Z', timezone: 'UTC' },
        allDay: false,
        timezone: 'UTC',
        status: 'cancelled',
        transparency: 'opaque',
        visibility: 'default',
        attendees: [],
        recurrenceMaster: false,
        exceptions: [],
        attachments: [],
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: new Date(),
      };

      expect(event.status).toBe('cancelled');
      expect(event.deletedAt).toBeDefined();
    });
  });

  describe('CreateEventInput', () => {
    it('should accept valid input', () => {
      const input: CreateEventInput = {
        title: 'New Event',
        start: { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00Z', timezone: 'UTC' },
      };

      expect(input.title).toBe('New Event');
      expect(input.start).toBeDefined();
    });

    it('should accept all-day events', () => {
      const input: CreateEventInput = {
        title: 'All Day Event',
        start: { date: '2024-01-15' },
        end: { date: '2024-01-16' },
        allDay: true,
      };

      expect(input.allDay).toBe(true);
    });

    it('should accept attendees', () => {
      const input: CreateEventInput = {
        title: 'Meeting',
        start: { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' },
        end: { dateTime: '2024-01-15T11:00:00Z', timezone: 'UTC' },
        attendees: [
          { email: 'person1@example.com' },
          { email: 'person2@example.com', displayName: 'Person 2' },
        ],
      };

      expect(input.attendees).toHaveLength(2);
    });
  });

  describe('UpdateEventInput', () => {
    it('should allow partial updates', () => {
      const update: UpdateEventInput = {
        title: 'Updated Title',
        description: 'New description',
      };

      expect(update.title).toBe('Updated Title');
      expect(update.description).toBe('New description');
    });

    it('should allow clearing recurrence', () => {
      const update: UpdateEventInput = {
        recurrence: null,
      };

      expect(update.recurrence).toBeNull();
    });
  });
});