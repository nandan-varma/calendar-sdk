import type { RawProviderData, Extensions } from './common.js';

export type CalendarAccessRole = 'owner' | 'writer' | 'reader' | 'freeBusyReader' | 'none';

export interface Calendar {
  id: string;
  accountId: string;
  providerId: string;
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  primary: boolean;
  readOnly: boolean;
  hidden: boolean;
  accessRole: CalendarAccessRole;
  capabilities: CalendarCapabilityMap;
  raw: RawProviderData;
  extensions: Extensions;
  createdAt: Date;
  updatedAt: Date;
}

export interface CalendarCapabilityMap {
  create: boolean;
  update: boolean;
  delete: boolean;
  share: boolean;
  manageNotifications: boolean;
}

export function getCalendarCapabilities(
  accessRole: CalendarAccessRole,
  raw?: RawProviderData
): CalendarCapabilityMap {
  const isOwner = accessRole === 'owner';
  const isWriter = accessRole === 'writer';
  const isReader = accessRole === 'reader';

  return {
    create: isOwner || isWriter,
    update: isOwner || isWriter,
    delete: isOwner,
    share: isOwner,
    manageNotifications: isOwner || isWriter,
  };
}

export interface CreateCalendarInput {
  name: string;
  description?: string;
  timezone?: string;
  color?: string;
  primary?: boolean;
}

export interface UpdateCalendarInput {
  name?: string;
  description?: string;
  timezone?: string;
  color?: string;
  hidden?: boolean;
}

export interface ListCalendarsQuery {
  pageToken?: string;
  limit?: number;
  showHidden?: boolean;
}

export interface ShareCalendarInput {
  email: string;
  role: CalendarAccessRole;
  sendNotifications?: boolean;
}
