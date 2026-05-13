import { describe, it, expect } from 'vitest';
import { type DateTime, type DateOnly, type DateTimeValue, isAllDay, toDate, toDateTimeString } from '../../../src/types/common.js';

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
      const googleTimed: DateTime = { dateTime: '2024-01-15T10:00:00-07:00', timezone: 'America/Los_Angeles' };
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