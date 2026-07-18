---
title: Sync
description: Full, incremental, and reconciliation sync with persisted cursors.
sidebar:
  order: 7
---

`sdk.sync` keeps your local store in step with the provider. Where the vendor supports it (Google `syncToken`, Microsoft Graph delta queries), sync is **incremental**: after an initial full sync you only fetch what changed.

## Concepts

- **`SyncCursor`** — an opaque provider token plus metadata (`accountId`, `scope`, `expiry`), persisted via `storage.syncCursors` keyed by account + scope.
- **`SyncResult`** — the outcome of a sync pass: changed `events` (created/updated), `deletions`, an optional `nextCursor`, and flags `expiredToken` / `hasMore`.
- Applied changes are written to storage as part of the sync (saves and deletes happen for you).

```typescript
interface SyncResult {
  accountId: string;
  scope: "calendars" | "events" | "all";
  events: SyncEvent[];      // { type: "created" | "updated", event } | { type: "deleted", eventId }
  deletions: string[];
  nextCursor?: SyncCursor;
  expiredToken: boolean;    // cursor invalid — run a full sync
  hasMore: boolean;
}
```

## Full sync

```typescript
const provider = sdk.getProvider(account.provider);

const result = await sdk.sync.fullSync(provider, account.id, {
  calendarId,                       // optional — defaults to every stored calendar
  timeMin: new Date("2026-01-01"),
  timeMax: new Date("2027-01-01"),
  limit: 2500,
});
```

Clears any existing cursor, pulls events for the selected calendars, persists all changes, and saves the fresh cursor returned by the provider so the next pass can be incremental.

## Incremental sync

```typescript
const cursor = await sdk.storage.syncCursors.get(account.id, "events");

if (!cursor) {
  await sdk.sync.fullSync(provider, account.id);
} else {
  const result = await sdk.sync.incrementalSync(provider, account.id, cursor);

  if (result.expiredToken) {
    // Provider invalidated the token (e.g. HTTP 410 from Google) — start over
    await sdk.sync.fullSync(provider, account.id);
  }
}
```

On success the advanced cursor is persisted automatically. When the provider reports the cursor expired (`SYNC_CURSOR_EXPIRED` / HTTP 410), the SDK deletes the stored cursor and returns `expiredToken: true` instead of throwing.

## Reconciliation

For drift repair (missed webhooks, partial failures), `reconcile` diffs local storage against a fresh provider snapshot:

```typescript
const { created, updated, deleted } = await sdk.sync.reconcile(
  provider,
  account.id,
  "events",
  { timeMin, timeMax },
);
```

Events present remotely are upserted; local events missing remotely are deleted.

## Sync status

```typescript
const status = await sdk.sync.getSyncStatus(account.id);
// {
//   accountId,
//   cursors: [{ scope, hasCursor, expired, expiresAt }],
//   lastSync?: Date
// }
```

Useful for dashboards and deciding whether a full sync is due.

## A typical polling loop

```typescript
async function syncAccount(accountId: string) {
  const account = await sdk.accounts.get(accountId);
  if (!account) return;

  const provider = sdk.getProvider(account.provider);
  const cursor = await sdk.storage.syncCursors.get(accountId, "events");

  const result = cursor
    ? await sdk.sync.incrementalSync(provider, accountId, cursor)
    : await sdk.sync.fullSync(provider, accountId);

  if (result.expiredToken) {
    await sdk.sync.fullSync(provider, accountId);
  }
}
```

Run this on a schedule for CalDAV (`sync.incremental: false` — every pass is effectively full), and on webhook notifications for Google/Microsoft — see [Webhooks](/guides/webhooks/).
