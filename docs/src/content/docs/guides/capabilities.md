---
title: Capabilities
description: Discover what each provider supports before you call it.
sidebar:
  order: 12
---

Providers differ. Rather than letting you discover unsupported behavior via cryptic vendor errors, every account carries a `CapabilityMap` and services check it up front — unsupported operations throw `CAPABILITY_UNSUPPORTED` with a remediation hint before any network call.

## Checking capabilities

```typescript
const account = await sdk.accounts.get(accountId);

if (account?.capabilities.sync.webhook) {
  await sdk.subscriptions.create(accountId, config);
} else {
  schedulePolling(accountId); // e.g. CalDAV
}
```

The map is snapshotted from the provider adapter at connect time:

```typescript
interface CapabilityMap {
  calendars: { create; update; delete; share; manageNotifications };
  events:    { list; create; update; delete; move; duplicate; attachments; conferenceData };
  sync:      { incremental; webhook; polling };
  availability: { freeBusy; suggestedTimes };
}
```

## What each provider supports

| Capability | Google | Microsoft | CalDAV |
| --- | :-: | :-: | :-: |
| **Calendars** — create / update / delete | ✅ | ✅ | ✅ |
| Calendars — share | ✅ | ✅ | ❌ |
| Calendars — manage notifications | ✅ | ❌ | ❌ |
| **Events** — list / create / update / delete | ✅ | ✅ | ✅ |
| Events — move between calendars | ✅ | ✅ | ❌ |
| Events — duplicate | ✅ | ❌ | ❌ |
| Events — attachments | ✅ | ✅ | ❌ |
| Events — conference data (Meet/Teams) | ✅ | ✅ | ❌ |
| **Sync** — incremental (`syncToken`/delta) | ✅ | ✅ | ❌ |
| Sync — webhooks | ✅ | ✅ | ❌ |
| Sync — polling | ✅ | ✅ | ✅ |
| **Availability** — free/busy | ✅ | ✅ | ✅ |
| Availability — suggested meeting times | ❌ | ✅ | ❌ |

`sdk.calendars.share()` is wired to Google's Calendar ACL API and Microsoft Graph's `calendarPermissions` API — see [Calendars](/guides/calendars/). CalDAV has no standard sharing protocol, so it reports `share: false`.

## Per-calendar capabilities

Independently of the provider map, each `Calendar` carries its own capability map derived from your **access role** on that calendar: `owner`/`writer` can create and update events, only `owner` can delete or share the calendar. A `reader` calendar on Google is still read-only even though Google "supports" event creation.

## Utilities

```typescript
import {
  defaultCapabilityMap,
  getCapabilitiesForProvider,
  mergeCapabilities,
} from "@nandan-varma/calendar-sdk";

getCapabilitiesForProvider("microsoft"); // canonical map for a provider
mergeCapabilities(defaultCapabilityMap, { sync: { incremental: true, webhook: false, polling: true } });
```

Custom provider adapters declare their support by implementing `getCapabilities()` — see [Writing a provider adapter](/reference/provider-adapter/).
