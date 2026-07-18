---
title: Calendars
description: List, create, update, and delete calendars across providers.
sidebar:
  order: 4
---

`sdk.calendars` works with the calendar collections of a connected account. Listing also *persists* calendars to storage, which the other services rely on — make it the first call after connecting an account.

## The Calendar model

```typescript
interface Calendar {
  id: string;            // SDK id — pass this to events.* and calendars.*
  accountId: string;
  providerId: string;    // vendor id (e.g. Google calendarId)
  name: string;
  description?: string;
  timezone: string;
  color?: string;
  primary: boolean;
  readOnly: boolean;
  hidden: boolean;
  accessRole: "owner" | "writer" | "reader" | "freeBusyReader" | "none";
  capabilities: CalendarCapabilityMap; // derived from accessRole
  raw: unknown;
  extensions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

Per-calendar capabilities are derived from your access role: `owner`/`writer` can create and update, only `owner` can delete or share.

## API

### `list(accountId, query?)`

```typescript
const calendars = await sdk.calendars.list(account.id, {
  showHidden: false,
  limit: 50,
});
```

Fetches the account's calendars from the provider, saves each one to storage, and returns them. Query options: `pageToken`, `limit`, `showHidden`.

### `get(calendarId)`

```typescript
const calendar = await sdk.calendars.get(calendarId); // null if unknown
```

Reads from storage only.

### `create(accountId, input)`

```typescript
const calendar = await sdk.calendars.create(account.id, {
  name: "Team events",
  description: "Shared team calendar",
  timezone: "Europe/Berlin",
  color: "#0f766e",
});
```

Checks the provider's `calendars.create` capability first (`CAPABILITY_UNSUPPORTED` otherwise), creates the calendar remotely, and stores it under a new SDK id.

### `update(calendarId, patch)`

```typescript
const updated = await sdk.calendars.update(calendarId, {
  name: "Team events (2026)",
  hidden: false,
});
```

Patch fields: `name`, `description`, `timezone`, `color`, `hidden`.

### `delete(calendarId)`

```typescript
await sdk.calendars.delete(calendarId);
```

Deletes the calendar at the provider, then removes it **and all of its locally stored events**. Requires the `delete` capability (owner access). A no-op if the calendar isn't in storage.

### `share(calendarId, email, role)`

:::caution[Not yet implemented]
`share()` currently validates capabilities and logs, but does not call any provider ACL API yet. Track provider support via `account.capabilities.calendars.share` (Google and Microsoft report `true`, CalDAV `false`).
:::

## Errors you may encounter

| Code | When |
| --- | --- |
| `NOT_FOUND` | Account or calendar not in storage (did you call `calendars.list` first?) |
| `AUTH_REQUIRED` | Token missing/unrefreshable — reconnect the account |
| `CAPABILITY_UNSUPPORTED` | Operation not supported by the provider or your access role |
