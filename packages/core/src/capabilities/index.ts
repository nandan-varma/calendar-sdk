export interface CalendarCapabilityMap {
  create: boolean;
  update: boolean;
  delete: boolean;
  share: boolean;
  manageNotifications: boolean;
}

export interface EventCapabilityMap {
  list: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  move: boolean;
  duplicate: boolean;
  attachments: boolean;
  conferenceData: boolean;
}

export interface SyncCapabilityMap {
  incremental: boolean;
  webhook: boolean;
  polling: boolean;
}

export interface AvailabilityCapabilityMap {
  freeBusy: boolean;
  suggestedTimes: boolean;
}

export interface CapabilityMap {
  calendars: CalendarCapabilityMap;
  events: EventCapabilityMap;
  sync: SyncCapabilityMap;
  availability: AvailabilityCapabilityMap;
}

export const defaultCapabilityMap: CapabilityMap = {
  calendars: {
    create: true,
    update: true,
    delete: true,
    share: false,
    manageNotifications: false,
  },
  events: {
    list: true,
    create: true,
    update: true,
    delete: true,
    move: false,
    duplicate: false,
    attachments: false,
    conferenceData: false,
  },
  sync: {
    incremental: false,
    webhook: false,
    polling: true,
  },
  availability: {
    freeBusy: false,
    suggestedTimes: false,
  },
};

export function mergeCapabilities(
  base: CapabilityMap,
  overrides: Partial<CapabilityMap>
): CapabilityMap {
  return {
    calendars: { ...base.calendars, ...overrides.calendars },
    events: { ...base.events, ...overrides.events },
    sync: { ...base.sync, ...overrides.sync },
    availability: { ...base.availability, ...overrides.availability },
  };
}

export function getCapabilitiesForProvider(
  provider: 'google' | 'microsoft' | 'caldav'
): CapabilityMap {
  const base = defaultCapabilityMap;

  switch (provider) {
    case 'google':
      return {
        calendars: { ...base.calendars, share: true, manageNotifications: true },
        events: {
          list: true,
          create: true,
          update: true,
          delete: true,
          move: true,
          duplicate: true,
          attachments: true,
          conferenceData: true,
        },
        sync: {
          incremental: true,
          webhook: true,
          polling: true,
        },
        availability: {
          freeBusy: true,
          suggestedTimes: false,
        },
      };
    case 'microsoft':
      return {
        calendars: { ...base.calendars, share: true },
        events: {
          list: true,
          create: true,
          update: true,
          delete: true,
          move: true,
          duplicate: false,
          attachments: true,
          conferenceData: true,
        },
        sync: {
          incremental: true,
          webhook: true,
          polling: true,
        },
        availability: {
          freeBusy: true,
          suggestedTimes: true,
        },
      };
    case 'caldav':
      return {
        calendars: { ...base.calendars, create: true, update: true, delete: true },
        events: {
          list: true,
          create: true,
          update: true,
          delete: true,
          move: false,
          duplicate: false,
          attachments: false,
          conferenceData: false,
        },
        sync: {
          incremental: false,
          webhook: false,
          polling: true,
        },
        availability: {
          freeBusy: true,
          suggestedTimes: false,
        },
      };
  }
}
