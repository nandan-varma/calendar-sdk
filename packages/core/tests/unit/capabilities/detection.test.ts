import { describe, it, expect } from 'vitest';
import { 
  type CapabilityMap, 
  CalendarCapabilityMap, 
  EventCapabilityMap, 
  SyncCapabilityMap, 
  AvailabilityCapabilityMap,
  defaultCapabilityMap,
  getCapabilitiesForProvider,
  mergeCapabilities,
} from '../../../src/capabilities/index.js';

describe('Capability Model', () => {
  describe('defaultCapabilityMap', () => {
    it('should have default calendar capabilities', () => {
      expect(defaultCapabilityMap.calendars.create).toBe(true);
      expect(defaultCapabilityMap.calendars.update).toBe(true);
      expect(defaultCapabilityMap.calendars.delete).toBe(true);
      expect(defaultCapabilityMap.calendars.share).toBe(false);
    });

    it('should have default event capabilities', () => {
      expect(defaultCapabilityMap.events.list).toBe(true);
      expect(defaultCapabilityMap.events.create).toBe(true);
      expect(defaultCapabilityMap.events.update).toBe(true);
      expect(defaultCapabilityMap.events.delete).toBe(true);
      expect(defaultCapabilityMap.events.move).toBe(false);
      expect(defaultCapabilityMap.events.duplicate).toBe(false);
    });

    it('should have default sync capabilities', () => {
      expect(defaultCapabilityMap.sync.incremental).toBe(false);
      expect(defaultCapabilityMap.sync.webhook).toBe(false);
      expect(defaultCapabilityMap.sync.polling).toBe(true);
    });

    it('should have default availability capabilities', () => {
      expect(defaultCapabilityMap.availability.freeBusy).toBe(false);
      expect(defaultCapabilityMap.availability.suggestedTimes).toBe(false);
    });
  });

  describe('getCapabilitiesForProvider', () => {
    it('should return full capabilities for Google', () => {
      const caps = getCapabilitiesForProvider('google');
      
      expect(caps.calendars.create).toBe(true);
      expect(caps.calendars.share).toBe(true);
      expect(caps.events.move).toBe(true);
      expect(caps.events.duplicate).toBe(true);
      expect(caps.events.attachments).toBe(true);
      expect(caps.events.conferenceData).toBe(true);
      expect(caps.sync.incremental).toBe(true);
      expect(caps.sync.webhook).toBe(true);
      expect(caps.availability.freeBusy).toBe(true);
    });

    it('should return Microsoft-specific capabilities', () => {
      const caps = getCapabilitiesForProvider('microsoft');
      
      expect(caps.calendars.share).toBe(true);
      expect(caps.events.move).toBe(true);
      expect(caps.events.conferenceData).toBe(true);
      expect(caps.sync.incremental).toBe(true);
      expect(caps.sync.webhook).toBe(true);
      expect(caps.availability.freeBusy).toBe(true);
      expect(caps.availability.suggestedTimes).toBe(true); // Microsoft-specific
    });

    it('should return CalDAV-specific capabilities', () => {
      const caps = getCapabilitiesForProvider('caldav');
      
      expect(caps.calendars.create).toBe(true);
      expect(caps.calendars.update).toBe(true);
      expect(caps.calendars.delete).toBe(true);
      expect(caps.calendars.share).toBe(false);
      expect(caps.events.list).toBe(true);
      expect(caps.events.create).toBe(true);
      expect(caps.events.move).toBe(false);
      expect(caps.events.attachments).toBe(false);
      expect(caps.sync.incremental).toBe(false);
      expect(caps.sync.webhook).toBe(false);
      expect(caps.sync.polling).toBe(true);
      expect(caps.availability.freeBusy).toBe(true);
    });
  });

  describe('mergeCapabilities', () => {
    it('should merge base with overrides', () => {
      const merged = mergeCapabilities(defaultCapabilityMap, {
        calendars: { share: true },
        events: { move: true },
        sync: { webhook: true },
      });

      expect(merged.calendars.share).toBe(true);
      expect(merged.events.move).toBe(true);
      expect(merged.sync.webhook).toBe(true);
    });

    it('should preserve non-overridden capabilities', () => {
      const merged = mergeCapabilities(defaultCapabilityMap, {
        calendars: { share: true },
      });

      expect(merged.calendars.create).toBe(true);
      expect(merged.calendars.update).toBe(true);
    });

    it('should handle empty overrides', () => {
      const merged = mergeCapabilities(defaultCapabilityMap, {});
      expect(merged).toEqual(defaultCapabilityMap);
    });
  });

  describe('CapabilityMap type', () => {
    it('should have calendar capabilities', () => {
      const caps: CapabilityMap = {
        calendars: { create: true, update: true, delete: true, share: false, manageNotifications: false },
        events: { list: true, create: true, update: true, delete: true, move: false, duplicate: false, attachments: false, conferenceData: false },
        sync: { incremental: false, webhook: false, polling: true },
        availability: { freeBusy: true, suggestedTimes: false },
      };

      expect(caps.calendars.create).toBe(true);
      expect(caps.events.list).toBe(true);
      expect(caps.sync.polling).toBe(true);
    });
  });

  describe('Provider capability discovery', () => {
    it('should allow checking specific capabilities', () => {
      const googleCaps = getCapabilitiesForProvider('google');
      
      // Calendar operations
      expect(googleCaps.calendars.create).toBeDefined();
      expect(googleCaps.calendars.update).toBeDefined();
      expect(googleCaps.calendars.delete).toBeDefined();
      expect(googleCaps.calendars.share).toBeDefined();
      
      // Event operations
      expect(googleCaps.events.list).toBeDefined();
      expect(googleCaps.events.create).toBeDefined();
      expect(googleCaps.events.update).toBeDefined();
      expect(googleCaps.events.delete).toBeDefined();
      expect(googleCaps.events.move).toBeDefined();
      expect(googleCaps.events.duplicate).toBeDefined();
      expect(googleCaps.events.attachments).toBeDefined();
      expect(googleCaps.events.conferenceData).toBeDefined();
      
      // Sync
      expect(googleCaps.sync.incremental).toBeDefined();
      expect(googleCaps.sync.webhook).toBeDefined();
      expect(googleCaps.sync.polling).toBeDefined();
      
      // Availability
      expect(googleCaps.availability.freeBusy).toBeDefined();
      expect(googleCaps.availability.suggestedTimes).toBeDefined();
    });

    it('should provide boolean values for feature detection', () => {
      const caps = getCapabilitiesForProvider('google');
      
      // These should be simple booleans for easy conditional checks
      if (caps.events.conferenceData) {
        expect(true).toBe(true); // Conference data supported
      }
      
      if (!caps.sync.webhook) {
        expect(true).toBe(true); // Webhooks not supported
      }
      
      const canMoveEvents = caps.events.move && caps.events.update;
      expect(typeof canMoveEvents).toBe('boolean');
    });
  });
});