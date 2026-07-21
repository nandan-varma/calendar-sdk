---
title: Events
description: Create, query, update, move, and duplicate events with one canonical model.
sidebar:
  order: 5
---

`sdk.events` is the workhorse service. All methods operate on **SDK ids** — get calendar ids from `sdk.calendars.list` and event ids from `sdk.events.list`/`create`.

## Dates and times: `DateTimeValue`

Every start/end is a discriminated union of a timed value and an all-day value:

```typescript
// Timed
{ dateTime: "2026-08-01T10:00:00Z", timezone: "UTC" }

// All-day
{ date: "2026-08-01" }
```

Helpers exported from the core:

```typescript
import { isAllDay, toDate, toDateTimeString } from "@calendar-sdk/core";

isAllDay(event.start);          // type guard for the { date } form
toDate(event.start);            // → JavaScript Date
toDateTimeString(event.start);  // → ISO string or date string
```

## API

### `list(calendarId, query?)`

```typescript
const events = await sdk.events.list(calendarId, {
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 7 * 86400_000),
  singleEvents: true,   // expand recurring events into instances
  orderBy: "startTime",
  q: "standup",         // free-text search where supported
  limit: 100,
});
```

Fetches from the provider, stamps each event with SDK ids, saves them to storage, and returns them. Other query options: `pageToken`, `showDeleted`, `expanded`.

### `get(eventId)`

Reads from storage only; throws `NOT_FOUND` if this event hasn't been synced locally yet. Call `events.list(calendarId)` first.

### `create(calendarId, input, options?)`

```typescript
const event = await sdk.events.create(calendarId, {
  title: "Design review",
  description: "Weekly design sync",
  location: "Room 4 / Meet",
  start: { dateTime: "2026-08-01T10:00:00Z", timezone: "UTC" },
  end: { dateTime: "2026-08-01T11:00:00Z", timezone: "UTC" },
  attendees: [{ email: "ada@example.com", displayName: "Ada" }],
  reminders: [{ method: "popup", minutes: 10 }],
  recurrence: { rrule: "FREQ=WEEKLY;BYDAY=FR" },
  conference: { createRequest: true },  // e.g. Google Meet
}, {
  sendUpdates: "all",           // notify attendees
  conferenceDataVersion: 1,     // required by Google for conference creation
});
```

`CreateEventInput` also supports `allDay`, `timezone`, `status` (`confirmed`/`tentative`/`cancelled`), `transparency` (`opaque`/`transparent`), `visibility` (`default`/`public`/`private`), and `attachments` (where the provider supports them).

`EventOptions` (also accepted by `update`/`delete`): `sendNotifications`, `sendUpdates: "all" | "externalOnly" | "none"`, `supportsAttachments`, `conferenceDataVersion`.

### `update(eventId, patch, options?)`

```typescript
const updated = await sdk.events.update(eventId, {
  title: "Design review (moved)",
  start: { dateTime: "2026-08-01T14:00:00Z", timezone: "UTC" },
  end: { dateTime: "2026-08-01T15:00:00Z", timezone: "UTC" },
});
```

All fields are optional; `recurrence: null` and `conference: null` explicitly clear those properties.

### `delete(eventId, options?)`

```typescript
await sdk.events.delete(eventId, { sendUpdates: "none" });
```

Deletes remotely and removes the stored copy. A no-op if the event isn't in storage.

### `move(eventId, targetCalendarId)`

Moves an event between two calendars **of the same account** (`VALIDATION_FAILED` otherwise). Requires the provider `move` capability — Google and Microsoft support it, CalDAV does not.

### `duplicate(eventId, targetCalendarId)`

Copies an event into another calendar and stores the copy under a new SDK id. Google reports `duplicate: true`; Microsoft and CalDAV do not.

## Recurring events

- Set `recurrence` with an [RFC 5545](https://datatracker.ietf.org/doc/html/rfc5545) `rrule` string (plus optional `rdate`/`exdate`/`timezone`).
- The stored master has `recurrenceMaster: true`; expanded instances reference it via `recurringEventId`.
- To fetch instances in a window, list with `singleEvents: true`, or use the provider adapter's `expandRecurrence` directly for `ExpandedOccurrence[]`.
- Modified/cancelled instances surface in `event.exceptions`.

## Attendees, conferencing, attachments

- `attendees` on the model include `responseStatus` (`accepted`/`tentative`/`declined`/`needsAction`), `isOrganizer`, `isSelf`, and resource-room flags.
- `conference` carries provider conference data (Meet/Teams/Zoom/…): entry points with `uri`, `password`, `pin`.
- `attachments` are supported on Google and Microsoft (`capabilities.events.attachments`), not CalDAV.

## Errors you may encounter

| Code | When |
| --- | --- |
| `NOT_FOUND` | Calendar/event not in storage — populate via `calendars.list` / `events.list` first |
| `AUTH_REQUIRED` | Token missing or unrefreshable |
| `CAPABILITY_UNSUPPORTED` | `create`/`update`/`delete`/`move` not supported by this provider |
| `VALIDATION_FAILED` | e.g. moving an event across accounts |
| `RATE_LIMITED` | Provider throttling — retried automatically, thrown only after retries are exhausted |
