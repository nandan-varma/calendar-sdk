---
title: Availability
description: Free/busy lookups and meeting-time suggestions.
sidebar:
  order: 6
---

`sdk.availability` answers "when is this account busy?" and, on providers that support it, "when could these people meet?".

## Free/busy

```typescript
const result = await sdk.availability.freeBusy(account.id, {
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 86400_000),
  calendars: ["primary"],       // provider calendar ids
  timezone: "Europe/Berlin",    // optional
});

for (const [calendarId, blocks] of Object.entries(result.calendars)) {
  for (const block of blocks) {
    console.log(calendarId, block.start, "→", block.end, block.status);
  }
}
```

`FreeBusyResult.calendars` maps each queried calendar id to an array of blocks:

```typescript
interface FreeBusyBlock {
  start: Date;
  end: Date;
  status: "free" | "busy" | "tentative" | "unknown";
  transparency?: "transparent" | "opaque";
  busyType?: "busy" | "outOfOffice" | "workingElsewhere"; // Microsoft
}
```

All three providers support free/busy (`capabilities.availability.freeBusy`).

## Meeting-time suggestions

Backed by Microsoft Graph's `findMeetingTimes`. Google and CalDAV report `suggestedTimes: false` and the call throws `CAPABILITY_UNSUPPORTED`.

```typescript
const { meetingSuggestions, emptySuggestionsReason } = await sdk.availability.suggest(
  account.id,
  {
    timeMin: new Date(),
    timeMax: new Date(Date.now() + 3 * 86400_000),
    meetingDuration: 30,                 // minutes
    attendees: ["ada@example.com", "linus@example.com"],
    maxCandidates: 5,
    organizerConstraint: "free",
  },
);

for (const s of meetingSuggestions) {
  console.log(s.meetingTime, `confidence ${s.confidence}`);
}
```

Each `MeetingTimeSuggestion` includes the proposed `meetingTime`, a `confidence` score, the organizer's availability, and per-attendee availability.

## Guarding by capability

```typescript
if (account.capabilities.availability.suggestedTimes) {
  await sdk.availability.suggest(account.id, query);
} else {
  // fall back to your own slot-finding over freeBusy()
}
```
