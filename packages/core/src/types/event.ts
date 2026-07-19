import type { DateTimeValue, RawProviderData, Extensions } from './common.js';

export type EventStatus = 'confirmed' | 'tentative' | 'cancelled';
export type EventVisibility = 'default' | 'public' | 'private';
export type EventTransparency = 'transparent' | 'opaque';

export interface CalendarEvent {
  id: string;
  accountId: string;
  calendarId: string;
  providerId: string;
  iCalUid?: string;
  title: string;
  description?: string;
  location?: string;
  start: DateTimeValue;
  end: DateTimeValue;
  allDay: boolean;
  timezone: string;
  status: EventStatus;
  transparency: EventTransparency;
  visibility: EventVisibility;
  attendees: Attendee[];
  organizer?: Organizer;
  reminders?: Reminder[];
  recurrence?: Recurrence;
  recurrenceMaster: boolean;
  recurringEventId?: string;
  occurrenceId?: string;
  exceptions: EventException[];
  conference?: ConferenceData;
  attachments: Attachment[];
  etag?: string;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  raw: RawProviderData;
  extensions: Extensions;
}

export interface Attendee {
  email: string;
  displayName?: string;
  responseStatus: 'accepted' | 'tentative' | 'declined' | 'needsAction';
  isOrganizer?: boolean;
  isSelf?: boolean;
  comment?: string;
  additionalGuests?: number;
  resource?: boolean;
}

export interface Organizer {
  email: string;
  displayName?: string;
  self?: boolean;
}

export type ReminderMethod = 'email' | 'popup' | 'sms' | 'audio';

export interface Reminder {
  method: ReminderMethod;
  minutes: number;
}

export interface Recurrence {
  rrule?: string;
  rdate?: string[];
  exdate?: string[];
  timezone?: string;
}

export interface ParsedRecurrenceRule {
  freq: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  until?: Date;
  count?: number;
  byDay?: string[];
  byMonthDay?: number[];
  byMonth?: number[];
  byWeekNo?: number[];
  byYearDay?: number[];
  byHour?: number[];
  byMinute?: number[];
  bySecond?: number[];
  wkst?: 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';
  tzid?: string;
}

export interface EventException {
  id: string;
  originalEventId: string;
  status: EventStatus;
  start: DateTimeValue;
  end: DateTimeValue;
  deleted: boolean;
  changes?: {
    title?: string;
    description?: string;
    location?: string;
    start?: DateTimeValue;
    end?: DateTimeValue;
    attendees?: Attendee[];
  };
}

export interface ConferenceData {
  provider: 'google' | 'microsoft' | 'zoom' | 'teams' | 'webex' | 'custom';
  conferenceId?: string;
  conferenceSolutionId?: string;
  entryPoints?: ConferenceEntryPoint[];
  notes?: string;
}

export interface ConferenceEntryPoint {
  entryPointType: 'video' | 'phone' | 'sip' | 'more';
  uri: string;
  label?: string;
  password?: string;
  pin?: string;
}

export interface Attachment {
  id: string;
  title: string;
  mimeType: string;
  size?: number;
  iconUrl?: string;
  fileUrl?: string;
  isInline?: boolean;
}

export interface CreateEventInput {
  title: string;
  description?: string;
  location?: string;
  start: DateTimeValue;
  end: DateTimeValue;
  allDay?: boolean;
  timezone?: string;
  status?: EventStatus;
  transparency?: EventTransparency;
  visibility?: EventVisibility;
  attendees?: AttendeeInput[];
  reminders?: Reminder[];
  recurrence?: Recurrence;
  conference?: CreateConferenceInput;
  attachments?: CreateAttachmentInput[];
}

export interface AttendeeInput {
  email: string;
  displayName?: string;
  comment?: string;
  additionalGuests?: number;
}

export interface CreateConferenceInput {
  createRequest?: boolean;
  conferenceSolutionId?: string;
}

export interface CreateAttachmentInput {
  title: string;
  mimeType: string;
  fileUrl?: string;
}

export interface UpdateEventInput {
  title?: string;
  description?: string;
  location?: string;
  start?: DateTimeValue;
  end?: DateTimeValue;
  allDay?: boolean;
  timezone?: string;
  status?: EventStatus;
  transparency?: EventTransparency;
  visibility?: EventVisibility;
  attendees?: AttendeeInput[];
  reminders?: Reminder[];
  recurrence?: Recurrence | null;
  conference?: CreateConferenceInput | null;
  attachments?: CreateAttachmentInput[];
}

export interface ListEventsQuery {
  pageToken?: string;
  limit?: number;
  timeMin?: Date;
  timeMax?: Date;
  showDeleted?: boolean;
  singleEvents?: boolean;
  expanded?: boolean;
  orderBy?: 'startTime' | 'updated';
  q?: string;
}

export interface EventOptions {
  sendNotifications?: boolean;
  sendUpdates?: 'all' | 'externalOnly' | 'none';
  supportsAttachments?: boolean;
  conferenceDataVersion?: number;
}

export interface ExpandedOccurrence {
  id: string;
  eventId: string;
  title: string;
  start: DateTimeValue;
  end: DateTimeValue;
  allDay: boolean;
  status: EventStatus;
  location?: string;
  recurrenceException?: boolean;
}
