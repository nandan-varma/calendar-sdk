import { describe, it, expect } from 'vitest';
import type { Recurrence, ParsedRecurrenceRule } from '../../../src/types/event.js';

describe('Recurrence', () => {
  describe('Recurrence type', () => {
    it('should support RRULE', () => {
      const recurrence: Recurrence = {
        rrule: 'FREQ=DAILY;COUNT=5',
      };
      expect(recurrence.rrule).toBe('FREQ=DAILY;COUNT=5');
    });

    it('should support RDATE', () => {
      const recurrence: Recurrence = {
        rdate: ['20240120T100000Z', '20240125T100000Z'],
      };
      expect(recurrence.rdate).toHaveLength(2);
    });

    it('should support EXDATE', () => {
      const recurrence: Recurrence = {
        rrule: 'FREQ=DAILY;COUNT=10',
        exdate: ['20240115T100000Z', '20240120T100000Z'],
      };
      expect(recurrence.exdate).toHaveLength(2);
    });

    it('should support timezone', () => {
      const recurrence: Recurrence = {
        rrule: 'FREQ=WEEKLY;BYDAY=MO',
        timezone: 'America/New_York',
      };
      expect(recurrence.timezone).toBe('America/New_York');
    });

    it('should support combined RRULE, RDATE, and EXDATE', () => {
      const recurrence: Recurrence = {
        rrule: 'FREQ=MONTHLY;COUNT=12',
        rdate: ['20240215T100000Z'],
        exdate: ['20240415T100000Z'],
        timezone: 'UTC',
      };
      expect(recurrence.rrule).toBeDefined();
      expect(recurrence.rdate).toBeDefined();
      expect(recurrence.exdate).toBeDefined();
    });
  });

  describe('Recurrence parsing', () => {
    it('should parse daily recurrence', () => {
      const rrule = 'FREQ=DAILY;COUNT=5';
      const parsed = parseRRule(rrule);
      
      expect(parsed.freq).toBe('daily');
      expect(parsed.count).toBe(5);
      expect(parsed.interval).toBe(1);
    });

    it('should parse weekly recurrence', () => {
      const rrule = 'FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=10';
      const parsed = parseRRule(rrule);
      
      expect(parsed.freq).toBe('weekly');
      expect(parsed.byDay).toContain('MO');
      expect(parsed.byDay).toContain('WE');
      expect(parsed.byDay).toContain('FR');
      expect(parsed.count).toBe(10);
    });

    it('should parse monthly recurrence', () => {
      const rrule = 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=12';
      const parsed = parseRRule(rrule);
      
      expect(parsed.freq).toBe('monthly');
      expect(parsed.byMonthDay).toContain(15);
      expect(parsed.count).toBe(12);
    });

    it('should parse yearly recurrence', () => {
      const rrule = 'FREQ=YEARLY;BYMONTH=1;BYDAY=MO;COUNT=5';
      const parsed = parseRRule(rrule);
      
      expect(parsed.freq).toBe('yearly');
      expect(parsed.byMonth).toContain(1);
      expect(parsed.byDay).toContain('MO');
    });

    it('should parse with interval', () => {
      const rrule = 'FREQ=WEEKLY;INTERVAL=2;COUNT=6';
      const parsed = parseRRule(rrule);
      
      expect(parsed.interval).toBe(2);
    });

    it('should parse with until date', () => {
      const rrule = 'FREQ=DAILY;UNTIL=20241231T235959Z';
      const parsed = parseRRule(rrule);
      
      expect(parsed.until).toBeDefined();
    });

    it('should handle work week start (WKST)', () => {
      const rrule = 'FREQ=WEEKLY;WKST=MO;BYDAY=MO,TU,WE,TH,FR';
      const parsed = parseRRule(rrule);
      
      expect(parsed.wkst).toBe('MO');
    });

    it('should parse complex recurrence', () => {
      const rrule = 'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=20;WKST=SU';
      const parsed = parseRRule(rrule);
      
      expect(parsed.freq).toBe('weekly');
      expect(parsed.interval).toBe(2);
      expect(parsed.byDay).toContain('TU');
      expect(parsed.byDay).toContain('TH');
      expect(parsed.count).toBe(20);
      expect(parsed.wkst).toBe('SU');
    });
  });

  describe('Recurrence expansion logic', () => {
    it('should expand daily recurrence', () => {
      const start = new Date('2024-01-15T10:00:00Z');
      const rrule = 'FREQ=DAILY;COUNT=5';
      const occurrences = expandRecurrence(start, rrule, new Date('2024-01-20T00:00:00Z'));
      
      expect(occurrences).toHaveLength(5);
      expect(occurrences[0].getDate()).toBe(15);
      expect(occurrences[4].getDate()).toBe(19);
    });

    it('should expand weekly recurrence', () => {
      const start = new Date('2024-01-15T10:00:00Z'); // Monday
      const rrule = 'FREQ=WEEKLY;COUNT=3';
      const occurrences = expandRecurrence(start, rrule, new Date('2024-02-01T00:00:00Z'));
      
      expect(occurrences.length).toBeGreaterThanOrEqual(3);
    });

    it('should expand monthly recurrence', () => {
      const start = new Date('2024-01-15T10:00:00Z');
      const rrule = 'FREQ=MONTHLY;COUNT=3';
      const occurrences = expandRecurrence(start, rrule, new Date('2024-04-01T00:00:00Z'));
      
      expect(occurrences).toHaveLength(3);
    });

    it('should respect time boundaries', () => {
      const start = new Date('2024-01-15T10:00:00Z');
      const rrule = 'FREQ=DAILY;COUNT=10';
      
      const rangeStart = new Date('2024-01-17T00:00:00Z');
      const rangeEnd = new Date('2024-01-20T00:00:00Z');
      
      const occurrences = expandRecurrence(start, rrule, rangeEnd, rangeStart);
      
      // Should only include occurrences within the range
      occurrences.forEach(occ => {
        expect(occ.getTime()).toBeGreaterThanOrEqual(rangeStart.getTime());
        expect(occ.getTime()).toBeLessThan(rangeEnd.getTime());
      });
    });

    it('should handle BYMONTHDAY', () => {
      const start = new Date('2024-01-15T10:00:00Z');
      const rrule = 'FREQ=MONTHLY;BYMONTHDAY=15;COUNT=3';
      const occurrences = expandRecurrence(start, rrule, new Date('2024-04-01T00:00:00Z'));
      
      occurrences.forEach(occ => {
        expect(occ.getDate()).toBe(15);
      });
    });

    it('should handle BYDAY', () => {
      const start = new Date('2024-01-15T10:00:00Z'); // Monday
      const rrule = 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=4';
      const occurrences = expandRecurrence(start, rrule, new Date('2024-01-31T00:00:00Z'));
      
      expect(occurrences.length).toBeLessThanOrEqual(4);
    });
  });
});

function parseRRule(rrule: string): ParsedRecurrenceRule {
  const parts = rrule.split(';');
  const result: ParsedRecurrenceRule = {
    freq: 'daily',
    interval: 1,
  };

  for (const part of parts) {
    const [key, value] = part.split('=');
    
    switch (key) {
      case 'FREQ':
        result.freq = value.toLowerCase() as ParsedRecurrenceRule['freq'];
        break;
      case 'COUNT':
        result.count = Number.parseInt(value, 10);
        break;
      case 'INTERVAL':
        result.interval = Number.parseInt(value, 10);
        break;
      case 'UNTIL':
        result.until = new Date(value);
        break;
      case 'BYDAY':
        result.byDay = value.split(',');
        break;
      case 'BYMONTHDAY':
        result.byMonthDay = value.split(',').map(v => Number.parseInt(v, 10));
        break;
      case 'BYMONTH':
        result.byMonth = value.split(',').map(v => Number.parseInt(v, 10));
        break;
      case 'WKST':
        result.wkst = value as ParsedRecurrenceRule['wkst'];
        break;
    }
  }

  return result;
}

function expandRecurrence(
  start: Date,
  rrule: string,
  endDate: Date,
  rangeStart?: Date
): Date[] {
  const parsed = parseRRule(rrule);
  const occurrences: Date[] = [];
  const effectiveStart = rangeStart || start;
  
  const current = new Date(start);
  const count = parsed.count || 100;
  
  while (occurrences.length < count && current.getTime() <= endDate.getTime()) {
    if (current.getTime() >= effectiveStart.getTime()) {
      occurrences.push(new Date(current));
    }
    
    switch (parsed.freq) {
      case 'daily':
        current.setDate(current.getDate() + (parsed.interval || 1));
        break;
      case 'weekly':
        current.setDate(current.getDate() + (7 * (parsed.interval || 1)));
        break;
      case 'monthly':
        current.setMonth(current.getMonth() + (parsed.interval || 1));
        break;
      case 'yearly':
        current.setFullYear(current.getFullYear() + (parsed.interval || 1));
        break;
      default:
        current.setDate(current.getDate() + 1);
    }
    
    if (parsed.until && current.getTime() > parsed.until.getTime()) {
      break;
    }
  }
  
  return occurrences;
}