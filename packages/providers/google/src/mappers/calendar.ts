import type { Calendar } from '@calendar-sdk/core';
import type { GoogleCalendarListEntry, GoogleCalendarListResponse } from '../types/index.js';
import { v4 as uuidv4 } from 'uuid';

export function mapCalendarListResponse(
  response: GoogleCalendarListResponse,
  accountId: string
): Calendar[] {
  return response.items.map(entry => mapCalendar(entry, accountId));
}

export function mapCalendar(entry: GoogleCalendarListEntry, accountId: string): Calendar {
  const accessRole = mapAccessRole(entry.accessRole);
  
  return {
    id: uuidv4(),
    accountId,
    providerId: entry.id,
    name: entry.summary,
    description: entry.description,
    timezone: entry.timeZone || 'UTC',
    color: entry.color || entry.backgroundColor,
    primary: entry.selected ?? false,
    readOnly: entry.accessRole === 'reader' || entry.accessRole === 'freeBusyReader',
    hidden: !entry.selected,
    accessRole,
    capabilities: {
      create: accessRole === 'owner' || accessRole === 'writer',
      update: accessRole === 'owner' || accessRole === 'writer',
      delete: accessRole === 'owner',
      share: accessRole === 'owner',
      manageNotifications: accessRole === 'owner' || accessRole === 'writer',
    },
    raw: entry,
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function mapAccessRole(role: string): Calendar['accessRole'] {
  switch (role) {
    case 'owner': return 'owner';
    case 'writer': return 'writer';
    case 'reader': return 'reader';
    case 'freeBusyReader': return 'freeBusyReader';
    default: return 'none';
  }
}

export function toGoogleCalendarInput(input: {
  name: string;
  description?: string;
  timezone?: string;
  color?: string;
}): Partial<GoogleCalendarListEntry> {
  return {
    summary: input.name,
    description: input.description,
    timeZone: input.timezone,
    backgroundColor: input.color,
  };
}