import { describe, it, expect } from 'vitest';
import {
  type DateTime,
  type DateOnly,
  type DateTimeValue,
  isAllDay,
  toDate,
  toDateTimeString,
} from '../../../src/types/common.js';

describe('DateTime Types', () => {
  describe('isAllDay', () => {
    it('should return true for DateOnly', () => {
      const dateOnly: DateOnly = { date: '2024-01-15' };
      expect(isAllDay(dateOnly)).toBe(true);
    });

    it('should return false for DateTime', () => {
      const dateTime: DateTime = { dateTime: '2024-01-15T10:00:00', timezone: 'UTC' };
      expect(isAllDay(dateTime)).toBe(false);
    });

    it('should correctly identify all-day events from Google format', () => {
      const googleAllDay: DateOnly = { date: '2024-01-15' };
      expect(isAllDay(googleAllDay)).toBe(true);
    });

    it('should correctly identify timed events from Google format', () => {
      const googleTimed: DateTime = {
        dateTime: '2024-01-15T10:00:00-07:00',
        timezone: 'America/Los_Angeles',
      };
      expect(isAllDay(googleTimed)).toBe(false);
    });
  });

  describe('toDate', () => {
    it('should convert DateTime to Date', () => {
      const dateTime: DateTime = { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' };
      const result = toDate(dateTime);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
    });

    it('should convert DateOnly to Date', () => {
      const dateOnly: DateOnly = { date: '2024-01-15' };
      const result = toDate(dateOnly);
      expect(result.getFullYear()).toBe(2024);
      expect(result.getMonth()).toBe(0);
      expect(result.getDate()).toBe(15);
    });

    it('should handle empty dateTime', () => {
      const dateTime: DateTime = { dateTime: '', timezone: 'UTC' };
      const result = toDate(dateTime);
      expect(result.getTime()).toBeDefined();
    });
  });

  describe('toDateTimeString', () => {
    it('should return date string for all-day events', () => {
      const dateOnly: DateOnly = { date: '2024-01-15' };
      expect(toDateTimeString(dateOnly)).toBe('2024-01-15');
    });

    it('should return dateTime string for timed events', () => {
      const dateTime: DateTime = { dateTime: '2024-01-15T10:00:00', timezone: 'UTC' };
      expect(toDateTimeString(dateTime)).toBe('2024-01-15T10:00:00');
    });

    it('should return empty string for empty dateTime', () => {
      const dateTime: DateTime = { dateTime: '', timezone: 'UTC' };
      expect(toDateTimeString(dateTime)).toBe('');
    });

    it('regression: converting to a different timezone returns a parseable ISO string, not a locale-formatted one', () => {
      const dateTime: DateTime = { dateTime: '2024-06-15T18:00:00Z', timezone: 'UTC' };
      const result = toDateTimeString(dateTime, 'America/Los_Angeles');

      // Previously this was `date.toLocaleString(...)`, e.g. "6/15/2024, 11:00:00 AM" - not
      // ISO 8601, and `new Date(...)` on it would silently produce an Invalid Date.
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/);
      // Same instant, just expressed in the target timezone's wall-clock time (PDT is UTC-7 in June).
      expect(result).toBe('2024-06-15T11:00:00-07:00');
      expect(new Date(result).getTime()).toBe(new Date(dateTime.dateTime).getTime());
    });
  });

  describe('DateTimeValue type guard', () => {
    it('should accept DateTime', () => {
      const value: DateTimeValue = { dateTime: '2024-01-15T10:00:00Z', timezone: 'UTC' };
      expect('dateTime' in value).toBe(true);
    });

    it('should accept DateOnly', () => {
      const value: DateTimeValue = { date: '2024-01-15' };
      expect('date' in value).toBe(true);
    });
  });
});
