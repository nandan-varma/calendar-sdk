export interface GoogleCalendarListEntry {
  kind: string;
  etag: string;
  id: string;
  summary: string;
  description?: string;
  timeZone?: string;
  color?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  selected?: boolean;
  accessRole: string;
  defaultReminders?: Array<{ method: string; minutes: number }>;
  conferenceProperties?: {
    allowedConferenceSolutionTypes: string[];
  };
}

export interface GoogleCalendarListResponse {
  kind: string;
  etag: string;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: GoogleCalendarListEntry[];
}

export interface GoogleEvent {
  kind: string;
  etag: string;
  id: string;
  status: string;
  htmlLink?: string;
  created?: string;
  updated?: string;
  summary?: string;
  description?: string;
  location?: string;
  colorId?: string;
  start?: GoogleEventDateTime;
  end?: GoogleEventDateTime;
  endTimeUnspecified?: boolean;
  recurrence?: string[];
  recurrenceRule?: string;
  recurringEventId?: string;
  originalStartTime?: GoogleEventDateTime;
  transparency?: string;
  visibility?: string;
  iCalUID?: string;
  attendeeOmitted?: boolean;
  attendees?: GoogleAttendee[];
  extendedProperties?: {
    private?: Record<string, string>;
    shared?: Record<string, string>;
  };
  conferenceData?: GoogleConferenceData;
  gadget?: {
    display?: string;
    iconLink?: string;
    link?: string;
    title?: string;
    type?: string;
  };
  anyoneCanAddSelf?: boolean;
  guestsCanInviteOthers?: boolean;
  guestsCanModify?: boolean;
  locked?: boolean;
  reminders?: GoogleReminders;
  source?: {
    title: string;
    url: string;
  };
  attachments?: GoogleAttachment[];
  eventType?: string;
}

export interface GoogleEventDateTime {
  date?: string;
  dateTime?: string;
  timeZone?: string;
}

export interface GoogleAttendee {
  email: string;
  displayName?: string;
  responseStatus?: string;
  comment?: string;
  additionalGuests?: number;
  organizer?: boolean;
  self?: boolean;
  resource?: boolean;
  optional?: boolean;
}

export interface GoogleReminders {
  useDefault: boolean;
  overrides?: Array<{ method: string; minutes: number }>;
}

export interface GoogleConferenceData {
  createRequest?: {
    requestId: string;
    conferenceSolutionKey: { type: string };
  };
  entryPoints?: Array<{
    entryPointType: string;
    uri: string;
    label?: string;
    password?: string;
    pin?: string;
  }>;
  conferenceSolution?: {
    name: string;
    iconUri: string;
    key: { type: string };
  };
  conferenceId?: string;
}

export interface GoogleAttachment {
  fileUrl?: string;
  title?: string;
  mimeType?: string;
  iconLink?: string;
  fileId?: string;
}

export interface GoogleEventsResponse {
  kind: string;
  etag: string;
  summary?: string;
  description?: string;
  nextPageToken?: string;
  nextSyncToken?: string;
  items: GoogleEvent[];
}

export interface GoogleFreeBusy {
  kind: string;
  timeZone?: string;
  calendars: Record<string, GoogleFreeBusyCalendar>;
}

export interface GoogleFreeBusyCalendar {
  errors?: Array<{ domain: string; reason: string }>;
  busy: Array<{ start: string; end: string }>;
}

export interface GoogleWatchResponse {
  kind: string;
  channelId: string;
  resourceId: string;
  resourceUri: string;
  expiration: string;
}

export interface GoogleUser {
  kind: string;
  id: string;
  email: string;
  name?: string;
  picture?: string;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope: string;
  token_type: string;
  expiry_date: number;
}

export interface GoogleAclRule {
  kind: string;
  etag: string;
  id: string;
  scope: {
    type: string;
    value: string;
  };
  role: string;
}