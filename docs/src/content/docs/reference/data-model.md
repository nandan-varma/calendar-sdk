---
title: Data model
description: The canonical types shared by every provider — accounts, calendars, events, availability, sync, and subscriptions.
sidebar:
  order: 2
---

All types are exported from `@nandan-varma/calendar-sdk`. Three conventions run through the whole model:

- **`id` vs `providerId`** — `id` is an SDK-generated UUID (stable, what you pass to services); `providerId` is the vendor's identifier.
- **`raw` and `extensions`** — the original provider payload is preserved on `raw`; provider-only extras live in `extensions`. Nothing is discarded.
- **`DateTimeValue`** — start/end values are a union of timed (`{ dateTime, timezone }`) and all-day (`{ date }`) forms, with `isAllDay` / `toDate` / `toDateTimeString` helpers.

## Account

```typescript
type AccountStatus = "connected" | "disconnected" | "expired" | "error";

interface Account {
  id: string;
  provider: "google" | "microsoft" | "caldav";
  displayName: string;
  email: string;
  status: AccountStatus;
  capabilities: CapabilityMap;
  raw: unknown;
  extensions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

Inputs: `AuthInput` (`authorizationCode` / `accessToken` / `refreshToken` / `redirectUri` / `scope`), `ConnectOptions` (`authInput`, `scopes?`, `persistTokens?`).

## Calendar

```typescript
type CalendarAccessRole = "owner" | "writer" | "reader" | "freeBusyReader" | "none";

interface Calendar {
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
  raw: unknown;
  extensions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

Inputs/queries: `CreateCalendarInput`, `UpdateCalendarInput`, `ListCalendarsQuery`, `ShareCalendarInput`.

## CalendarEvent

```typescript
type EventStatus = "confirmed" | "tentative" | "cancelled";
type EventTransparency = "transparent" | "opaque";
type EventVisibility = "default" | "public" | "private";

interface CalendarEvent {
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
  reminders?: Reminder[];          // { method: "email" | "popup" | "sms" | "audio", minutes }
  recurrence?: Recurrence;         // { rrule?, rdate?, exdate?, timezone? }
  recurrenceMaster: boolean;
  recurringEventId?: string;
  occurrenceId?: string;
  exceptions: EventException[];
  conference?: ConferenceData;     // Meet/Teams/Zoom entry points
  attachments: Attachment[];
  etag?: string;
  version?: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt?: Date;
  raw: unknown;
  extensions: Record<string, unknown>;
}
```

Attendee response statuses: `accepted` / `tentative` / `declined` / `needsAction`.

Inputs/queries: `CreateEventInput`, `UpdateEventInput` (nullable `recurrence`/`conference` to clear), `ListEventsQuery` (`timeMin`, `timeMax`, `singleEvents`, `orderBy`, `q`, `showDeleted`, `limit`, `pageToken`), `EventOptions` (`sendUpdates`, `sendNotifications`, `supportsAttachments`, `conferenceDataVersion`), `ExpandedOccurrence`.

## Availability

```typescript
interface FreeBusyQuery {
  timeMin: Date;
  timeMax: Date;
  calendars: string[];   // provider calendar ids
  timezone?: string;
}

interface FreeBusyResult {
  calendars: Record<string, FreeBusyBlock[]>;
  timezone?: string;
}

interface FreeBusyBlock {
  start: Date;
  end: Date;
  status: "free" | "busy" | "tentative" | "unknown";
  transparency?: "transparent" | "opaque";
  busyType?: "busy" | "outOfOffice" | "workingElsewhere";
}
```

Plus `SuggestMeetingQuery` / `SuggestMeetingResult` / `MeetingTimeSuggestion` for Microsoft's meeting-time suggestions.

## Sync

```typescript
interface SyncCursor {
  id: string;
  provider: string;
  accountId: string;
  scope: "calendars" | "events" | "all";
  token: string;         // opaque provider token (syncToken / deltaLink)
  expiry: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

type SyncEvent =
  | { type: "created"; event: CalendarEvent }
  | { type: "updated"; event: CalendarEvent; previousEtag?: string }
  | { type: "deleted"; eventId: string };

interface SyncResult {
  accountId: string;
  scope: SyncScope;
  events: SyncEvent[];
  deletions: string[];
  nextCursor?: SyncCursor;
  expiredToken: boolean;
  hasMore: boolean;
}
```

## Subscription

```typescript
interface Subscription {
  id: string;
  accountId: string;
  provider: string;
  resource: string;
  webhookUrl?: string;
  leaseExpiry: Date;
  secret?: string;
  renewalPolicy: "auto" | "manual";
  status: "active" | "expired" | "error" | "paused";
  lastNotificationAt?: Date;
  lastNotificationStatus?: "success" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

Plus `SubscriptionConfig` (`resource`, `webhookUrl`, `leaseDurationSeconds`, `secret`, `retryPolicy`), `SubscriptionNotification`, and `SubscriptionChange`.

## Common

```typescript
type ProviderKey = "google" | "microsoft" | "caldav" | (string & {}); // the three built-ins, or any key a custom/testing provider registers under

interface Paginated<T> {
  items: T[];
  nextPageToken?: string;
  totalItems?: number;
}
```

`Paginated<T>` is the shape provider adapters return from list operations; services flatten it to arrays after persisting.
