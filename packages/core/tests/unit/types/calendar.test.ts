import { describe, it, expect } from 'vitest';
import type {
  Calendar,
  CalendarAccessRole,
  CreateCalendarInput,
  UpdateCalendarInput,
} from '../../../src/types/calendar.js';
import { getCalendarCapabilities } from '../../../src/types/calendar.js';

describe('Calendar Types', () => {
  describe('Calendar', () => {
    it('should have required fields', () => {
      const calendar: Calendar = {
        id: 'cal-1',
        accountId: 'account-1',
        providerId: 'provider-cal-1',
        name: 'My Calendar',
        timezone: 'America/Los_Angeles',
        primary: true,
        readOnly: false,
        hidden: false,
        accessRole: 'owner',
        capabilities: {
          create: true,
          update: true,
          delete: true,
          share: true,
          manageNotifications: true,
        },
        raw: {},
        extensions: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(calendar.id).toBe('cal-1');
      expect(calendar.name).toBe('My Calendar');
      expect(calendar.primary).toBe(true);
      expect(calendar.accessRole).toBe('owner');
    });

    it('should support all access roles', () => {
      const roles: CalendarAccessRole[] = ['owner', 'writer', 'reader', 'freeBusyReader', 'none'];

      roles.forEach((role) => {
        const calendar: Calendar = {
          id: 'cal-1',
          accountId: 'account-1',
          providerId: 'provider-cal-1',
          name: 'Test',
          timezone: 'UTC',
          primary: false,
          readOnly: role === 'reader' || role === 'freeBusyReader',
          hidden: false,
          accessRole: role,
          capabilities: getCalendarCapabilities(role),
          raw: {},
          extensions: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        expect(calendar.accessRole).toBe(role);
      });
    });

    it('should preserve raw provider data', () => {
      const calendar: Calendar = {
        id: 'cal-1',
        accountId: 'account-1',
        providerId: 'google-cal-1',
        name: 'Primary',
        timezone: 'America/Los_Angeles',
        primary: true,
        readOnly: false,
        hidden: false,
        accessRole: 'owner',
        capabilities: {
          create: true,
          update: true,
          delete: true,
          share: true,
          manageNotifications: true,
        },
        raw: {
          kind: 'calendar#calendarListEntry',
          etag: '"abc123"',
          backgroundColor: '#123456',
        },
        extensions: { customProperty: 'value' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(calendar.raw.kind).toBe('calendar#calendarListEntry');
      expect(calendar.raw.etag).toBe('"abc123"');
    });
  });

  describe('getCalendarCapabilities', () => {
    it('should return correct capabilities for owner', () => {
      const caps = getCalendarCapabilities('owner');
      expect(caps.create).toBe(true);
      expect(caps.update).toBe(true);
      expect(caps.delete).toBe(true);
      expect(caps.share).toBe(true);
      expect(caps.manageNotifications).toBe(true);
    });

    it('should return correct capabilities for writer', () => {
      const caps = getCalendarCapabilities('writer');
      expect(caps.create).toBe(true);
      expect(caps.update).toBe(true);
      expect(caps.delete).toBe(false);
      expect(caps.share).toBe(false);
      expect(caps.manageNotifications).toBe(true);
    });

    it('should return correct capabilities for reader', () => {
      const caps = getCalendarCapabilities('reader');
      expect(caps.create).toBe(false);
      expect(caps.update).toBe(false);
      expect(caps.delete).toBe(false);
      expect(caps.share).toBe(false);
      expect(caps.manageNotifications).toBe(false);
    });

    it('should return correct capabilities for freeBusyReader', () => {
      const caps = getCalendarCapabilities('freeBusyReader');
      expect(caps.create).toBe(false);
      expect(caps.update).toBe(false);
      expect(caps.delete).toBe(false);
      expect(caps.share).toBe(false);
      expect(caps.manageNotifications).toBe(false);
    });
  });

  describe('CreateCalendarInput', () => {
    it('should accept valid input with required fields', () => {
      const input: CreateCalendarInput = {
        name: 'New Calendar',
      };

      expect(input.name).toBe('New Calendar');
    });

    it('should accept all optional fields', () => {
      const input: CreateCalendarInput = {
        name: 'Full Calendar',
        description: 'Calendar description',
        timezone: 'Europe/London',
        color: '#FF5733',
        primary: true,
      };

      expect(input.description).toBe('Calendar description');
      expect(input.timezone).toBe('Europe/London');
      expect(input.color).toBe('#FF5733');
    });
  });

  describe('UpdateCalendarInput', () => {
    it('should allow partial updates', () => {
      const update: UpdateCalendarInput = {
        name: 'Updated Name',
      };

      expect(update.name).toBe('Updated Name');
    });

    it('should allow hiding calendar', () => {
      const update: UpdateCalendarInput = {
        hidden: true,
      };

      expect(update.hidden).toBe(true);
    });
  });
});
