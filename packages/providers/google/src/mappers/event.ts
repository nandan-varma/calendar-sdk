import type {
  CalendarEvent,
  DateTimeValue,
  DateOnly,
  DateTime,
  Attendee,
  Reminder,
  Recurrence,
  ConferenceData,
  Attachment,
  EventStatus,
  EventTransparency,
  EventVisibility,
} from '@calendar-sdk/core';
import type { GoogleEvent, GoogleEventsResponse } from '../types/index.js';
import { randomUUID } from 'node:crypto';

export function mapEventsResponse(
  response: GoogleEventsResponse,
  accountId: string,
  calendarId: string,
  providerCalendarId: string
): { items: CalendarEvent[]; nextPageToken?: string; nextSyncToken?: string } {
  return {
    items: response.items.map((e) => mapEvent(e, accountId, calendarId, providerCalendarId)),
    nextPageToken: response.nextPageToken,
    nextSyncToken: response.nextSyncToken,
  };
}

export function mapEvent(
  event: GoogleEvent,
  accountId: string,
  calendarId: string,
  providerCalendarId: string
): CalendarEvent {
  const start = mapDateTime(event.start);
  const end = mapDateTime(event.end);
  const allDay = !!event.start?.date;
  const organizerAttendee = event.attendees?.find((a) => a.organizer);

  return {
    id: event.id,
    accountId,
    calendarId,
    providerId: event.id,
    iCalUid: event.iCalUID,
    title: event.summary || '(No title)',
    description: event.description,
    location: event.location,
    start,
    end,
    allDay,
    timezone: start.timezone || 'UTC',
    status: mapStatus(event.status),
    transparency: mapTransparency(event.transparency),
    visibility: mapVisibility(event.visibility),
    attendees: mapAttendees(event.attendees),
    organizer: organizerAttendee?.email
      ? {
          email: organizerAttendee.email,
          displayName: organizerAttendee.displayName,
          self: organizerAttendee.self,
        }
      : undefined,
    reminders: mapReminders(event.reminders),
    recurrence: mapRecurrence(event.recurrence),
    recurrenceMaster: !event.recurringEventId,
    recurringEventId: event.recurringEventId,
    occurrenceId: event.originalStartTime?.dateTime || event.originalStartTime?.date,
    exceptions: [],
    conference: mapConferenceData(event.conferenceData),
    attachments: mapAttachments(event.attachments),
    etag: event.etag,
    version: event.etag,
    createdAt: event.created ? new Date(event.created) : new Date(),
    updatedAt: event.updated ? new Date(event.updated) : new Date(),
    deletedAt: event.status === 'cancelled' ? new Date() : undefined,
    raw: event,
    extensions: mapExtendedProperties(event.extendedProperties),
  };
}

function mapDateTime(dt: GoogleEvent['start']): DateTimeValue {
  if (dt?.date) {
    return { date: dt.date };
  }
  return {
    dateTime: dt?.dateTime || '',
    timezone: dt?.timeZone || 'UTC',
  };
}

function mapStatus(status: string | undefined): EventStatus {
  switch (status) {
    case 'confirmed':
      return 'confirmed';
    case 'tentative':
      return 'tentative';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'confirmed';
  }
}

function mapTransparency(transparency: string | undefined): EventTransparency {
  return transparency === 'transparent' ? 'transparent' : 'opaque';
}

function mapVisibility(visibility: string | undefined): EventVisibility {
  switch (visibility) {
    case 'public':
      return 'public';
    case 'private':
      return 'private';
    default:
      return 'default';
  }
}

function mapAttendees(attendees?: GoogleEvent['attendees']): Attendee[] {
  if (!attendees) return [];
  return attendees.map((a) => ({
    email: a.email,
    displayName: a.displayName,
    responseStatus: mapResponseStatus(a.responseStatus),
    isOrganizer: a.organizer,
    isSelf: a.self,
    comment: a.comment,
    additionalGuests: a.additionalGuests,
    resource: a.resource,
  }));
}

function mapResponseStatus(status?: string): Attendee['responseStatus'] {
  switch (status) {
    case 'accepted':
      return 'accepted';
    case 'tentative':
      return 'tentative';
    case 'declined':
      return 'declined';
    default:
      return 'needsAction';
  }
}

function mapReminders(reminders?: GoogleEvent['reminders']): Reminder[] {
  if (!reminders || reminders.useDefault) {
    return [{ method: 'popup', minutes: 30 }];
  }
  return (reminders.overrides || []).map((r) => ({
    method: mapReminderMethod(r.method),
    minutes: r.minutes,
  }));
}

function mapReminderMethod(method: string): Reminder['method'] {
  switch (method) {
    case 'email':
      return 'email';
    case 'popup':
      return 'popup';
    case 'sms':
      return 'sms';
    default:
      return 'popup';
  }
}

function mapRecurrence(recurrence?: string[]): Recurrence | undefined {
  if (!recurrence || recurrence.length === 0) return undefined;
  return { rrule: recurrence[0] };
}

function mapConferenceData(data?: GoogleEvent['conferenceData']): ConferenceData | undefined {
  if (!data) return undefined;
  return {
    provider: mapConferenceProvider(data.conferenceSolution?.key?.type),
    conferenceId: data.conferenceId,
    conferenceSolutionId: data.conferenceSolution?.key?.type,
    entryPoints: data.entryPoints?.map((ep) => ({
      entryPointType: ep.entryPointType as NonNullable<
        ConferenceData['entryPoints']
      >[number]['entryPointType'],
      uri: ep.uri,
      label: ep.label,
      password: ep.password,
      pin: ep.pin,
    })),
    notes: data.createRequest?.requestId,
  };
}

function mapConferenceProvider(type?: string): ConferenceData['provider'] {
  switch (type) {
    case 'hangoutsMeet':
      return 'google';
    case 'addOn':
      return 'custom';
    default:
      return 'custom';
  }
}

function mapAttachments(attachments?: GoogleEvent['attachments']): Attachment[] {
  if (!attachments) return [];
  return attachments.map((a, i) => ({
    id: a.fileId || randomUUID(),
    title: a.title || 'Attachment',
    mimeType: a.mimeType || 'application/octet-stream',
    size: undefined,
    iconUrl: a.iconLink,
    fileUrl: a.fileUrl,
    isInline: false,
  }));
}

function mapExtendedProperties(props?: GoogleEvent['extendedProperties']): Record<string, unknown> {
  if (!props) return {};
  return {
    private: props.private || {},
    shared: props.shared || {},
  };
}
