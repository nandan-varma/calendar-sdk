---
title: Microsoft (Outlook)
description: Set up an Azure app registration and use the Microsoft Graph provider adapter.
sidebar:
  order: 2
---

`@nandan-varma/calendar-sdk-microsoft` adapts [Microsoft Graph](https://learn.microsoft.com/graph/api/resources/calendar) calendars (Outlook / Microsoft 365) to the canonical model, including delta-query incremental sync, change-notification webhooks, and Graph's unique `findMeetingTimes` suggestions.

## Credentials

1. Register an application in the [Azure Portal](https://portal.azure.com) (Microsoft Entra ID → App registrations).
2. Add the delegated **`Calendars.ReadWrite`** Microsoft Graph permission (plus `User.Read` for the profile and `offline_access` for refresh tokens).
3. Create a **client secret** and register your redirect URI.

## Setup

```typescript
import { createCalendarSdk } from "@nandan-varma/calendar-sdk";
import { createMicrosoftProvider } from "@nandan-varma/calendar-sdk-microsoft";

const sdk = createCalendarSdk({
  providers: [
    {
      key: "microsoft",
      adapter: createMicrosoftProvider({
        clientId: process.env.MICROSOFT_CLIENT_ID!,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
        redirectUri: "https://app.example.com/oauth/microsoft/callback", // optional default
        tenantId: "common", // default; use your tenant id for single-tenant apps
      }),
    },
  ],
});
```

`tenantId` selects the OAuth authority (`https://login.microsoftonline.com/{tenantId}/oauth2/v2.0/...`): `common` for any account, `organizations` for work/school only, `consumers` for personal accounts, or a specific tenant GUID.

### Scopes

```
Calendars.ReadWrite  Calendars.Read  User.Read  offline_access
```

Include `offline_access` or Microsoft will not return a refresh token.

## Capabilities

- ✅ incremental sync (delta queries), webhooks (Graph subscriptions), polling
- ✅ event move, attachments, conference data (Teams)
- ✅ free/busy **and suggested meeting times** — the only provider with `suggestedTimes: true`
- ❌ event duplicate (create a copy instead)

## Microsoft-specific notes

- **Meeting suggestions** — `sdk.availability.suggest` maps to Graph `findMeetingTimes`; see [Availability](/guides/availability/).
- **Subscriptions** — Graph change-notification subscriptions have short maximum lease durations for calendar resources (a few days); use `subscriptions.renew`/`checkExpiry` on a schedule. Graph validates your endpoint with a `validationToken` handshake at creation, and echoes your `secret` back as `clientState` on each notification — verify it.
- **Free/busy `busyType`** — Graph distinguishes `busy`, `outOfOffice`, and `workingElsewhere`; this surfaces on `FreeBusyBlock.busyType`.
- **Delta token expiry** — like Google, an invalidated delta token results in `expiredToken: true` from incremental sync; run a full sync to recover.
