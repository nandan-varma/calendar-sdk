---
title: CalDAV (iCloud & self-hosted)
description: Connect standards-based CalDAV servers — iCloud, Fastmail, Nextcloud, Radicale, and more.
sidebar:
  order: 3
---

`@nandan-varma/calendar-sdk-caldav` speaks [CalDAV](https://datatracker.ietf.org/doc/html/rfc4791) (calendar access over WebDAV, with iCalendar payloads). It is the interoperability path for **iCloud/Apple Calendar**, Fastmail, Nextcloud, Radicale, Baïkal, and any other standards-compliant server.

## Setup

CalDAV uses HTTP **Basic auth**, not OAuth — credentials go straight into the provider config:

```typescript
import { createCalendarSdk } from "@nandan-varma/calendar-sdk";
import { createCalDavProvider } from "@nandan-varma/calendar-sdk-caldav";

const sdk = createCalendarSdk({
  providers: [
    createCalDavProvider({
      serverUrl: "https://caldav.example.com",
      username: "ada@example.com",
      password: process.env.CALDAV_PASSWORD!,
      headers: {},              // optional extra headers on every request
    }),
  ],
});
```

### Connecting an account

There is no code exchange; `connect` just materializes the configured credentials into a token set:

```typescript
const account = await sdk.accounts.connect("caldav", {
  authInput: { authorizationCode: "caldav" }, // value is ignored — credentials come from the config
});
```

:::note
One `createCalDavProvider(...)` instance carries one set of credentials. To serve many CalDAV users, create one SDK/provider instance per credential set (the SDK is lightweight), or manage adapters per user.
:::

### Common servers

| Server | `serverUrl` | Credentials |
| --- | --- | --- |
| iCloud | `https://caldav.icloud.com` | Apple ID + [app-specific password](https://support.apple.com/102654) |
| Fastmail | `https://caldav.fastmail.com` | Username + app password |
| Nextcloud | `https://cloud.example.com/remote.php/dav` | Username + password/app token |
| Radicale / Baïkal | your deployment URL | As configured |

## Capabilities

CalDAV is deliberately the most conservative provider:

- ✅ calendars: create / update / delete
- ✅ events: list / create / update / delete
- ✅ free/busy, polling sync
- ❌ incremental sync tokens, webhooks — poll with [`sdk.sync`](/guides/sync/) on a schedule
- ❌ event move/duplicate, attachments, conference data, calendar sharing, meeting suggestions

Because `sync.incremental` is `false`, a periodic `fullSync` (optionally windowed with `timeMin`/`timeMax`) is the synchronization strategy.

## Notes

- Tokens for CalDAV are synthesized Basic-auth values; there is nothing to refresh or revoke, and account status never expires from token age.
- Recurrence, free/busy, and event data map through iCalendar (RFC 5545) semantics; provider-specific extras remain available on `raw`.
