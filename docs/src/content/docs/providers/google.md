---
title: Google Calendar
description: Set up OAuth credentials and use the Google Calendar provider adapter.
sidebar:
  order: 1
---

`@nandan-varma/calendar-sdk-google` adapts the [Google Calendar API v3](https://developers.google.com/calendar/api) to the canonical model. It is the most fully featured provider: incremental sync via `syncToken`, watch-channel webhooks, attachments, Meet conference data, and event move/duplicate.

## Credentials

1. Create a project in the [Google Cloud Console](https://console.cloud.google.com).
2. Enable the **Google Calendar API**.
3. Create **OAuth 2.0 credentials** (Web application) and register your redirect URI.

## Setup

```typescript
import { createCalendarSdk } from "@nandan-varma/calendar-sdk";
import { createGoogleProvider } from "@nandan-varma/calendar-sdk-google";

const sdk = createCalendarSdk({
  providers: [
    {
      key: "google",
      adapter: createGoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        redirectUri: "https://app.example.com/oauth/google/callback", // optional default
        // logger: myLogger,                                          // optional
      }),
    },
  ],
});
```

### Scopes

Request the narrowest scope that covers your use case:

| Scope | Grants |
| --- | --- |
| `https://www.googleapis.com/auth/calendar` | Full read/write |
| `https://www.googleapis.com/auth/calendar.events` | Event read/write |
| `https://www.googleapis.com/auth/calendar.readonly` | Read-only |
| `https://www.googleapis.com/auth/calendar.freebusy` | Free/busy only |

:::caution[Refresh tokens]
Google only issues a refresh token when the authorization request includes `access_type=offline` (and re-issues it with `prompt=consent`). The [auth helper](/guides/authentication/) sets both automatically. Without a refresh token the SDK cannot keep the account alive past the first hour.
:::

## Capabilities

Everything except meeting-time suggestions:

- ✅ incremental sync (`syncToken`), webhooks (watch channels), polling
- ✅ event move **and** duplicate, attachments, conference data (Google Meet)
- ✅ free/busy
- ❌ suggested meeting times (use Microsoft, or build on `freeBusy`)

## Google-specific notes

- **Conference data** — pass `conference: { createRequest: true }` in `CreateEventInput` together with the `conferenceDataVersion: 1` event option to auto-create a Meet link.
- **Watch channels** — subscriptions map to `events.watch` channels; leases are short and channel stops are best-effort, so schedule renewal (see [Webhooks](/guides/webhooks/)).
- **Sync token expiry** — Google returns HTTP 410 when a `syncToken` is too old; the SDK converts this to `expiredToken: true` on the sync result so you can fall back to a full sync.
- **Raw payloads** — the original Google resources are preserved on `raw` for every account, calendar, and event.
