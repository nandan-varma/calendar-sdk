---
title: Storage
description: The StorageAdapter interface, the in-memory default, and writing a database-backed adapter.
sidebar:
  order: 9
---

Everything the SDK knows — accounts, encrypted token sets, calendars, events, sync cursors, subscriptions — lives behind one `StorageAdapter`. The default is in-memory (great for development and tests, gone on restart); production apps supply their own.

```typescript
import { createCalendarSdk, createMemoryStorage } from "@calendar-sdk/core";

const sdk = createCalendarSdk({
  providers: [...],
  storage: myStorage,          // defaults to createMemoryStorage()
});

// The active adapter is exposed for direct access:
await sdk.storage.syncCursors.get(accountId, "events");
```

:::caution
`createPostgresStorage` and `createRedisStorage` are exported placeholders that currently throw `not implemented`. Bring your own adapter for production persistence.
:::

## The interface

```typescript
interface StorageAdapter {
  accounts: AccountsStorage;
  calendars: CalendarsStorage;
  events: EventsStorage;
  syncCursors: SyncCursorsStorage;
  subscriptions: SubscriptionsStorage;
  tokens: TokensStorage;
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}
```

Each repository is small and CRUD-shaped:

| Repository | Methods |
| --- | --- |
| `accounts` | `save`, `get`, `list`, `listByProvider`, `update`, `delete` |
| `calendars` | `save`, `get`, `list(accountId, query?)`, `listByAccount`, `update`, `delete` |
| `events` | `save`, `saveMany`, `get`, `list(calendarId, query?)`, `listByAccount`, `getByRecurringEventId`, `update`, `delete`, `deleteByCalendar` |
| `syncCursors` | `save`, `get(accountId, scope)`, `list`, `delete(accountId, scope)`, `deleteByAccount` |
| `subscriptions` | `save`, `get`, `list(accountId)`, `listByProvider`, `update`, `delete` |
| `tokens` | `save(accountId, tokens)`, `get`, `update`, `delete` |

Semantics worth matching when you implement your own:

- `get` returns `null` for unknown ids (never throws).
- `update` merges a partial into the existing record and bumps `updatedAt`; it is a no-op for unknown ids.
- `events.list` honors `timeMin`/`timeMax` (overlap semantics), `limit`, and `showDeleted: false`.
- `calendars.list` honors `showHidden: false` and `limit`.
- `transaction(fn)` may simply invoke `fn` if your backend has no transactions (that's what the memory adapter does).

## Token security

`tokens.save` receives an `EncryptedTokens` object — but **the SDK does not encrypt for you**. Encrypt/decrypt inside your adapter (or with a `TokenEncryptor` from `@calendar-sdk/auth`) before persisting:

```typescript
interface TokenEncryptor {
  encrypt(tokens: TokenSet): Promise<EncryptedTokenSet>;
  decrypt(encrypted: EncryptedTokenSet): Promise<TokenSet>;
}
```

## Sketch: a SQL-backed adapter

```typescript
import type { StorageAdapter } from "@calendar-sdk/core";

export function createSqlStorage(db: Db): StorageAdapter {
  return {
    accounts: {
      save: (a) => db.upsert("accounts", a),
      get: (id) => db.findOne("accounts", { id }),
      list: () => db.findMany("accounts", {}),
      listByProvider: (provider) => db.findMany("accounts", { provider }),
      update: (id, data) => db.patch("accounts", id, { ...data, updatedAt: new Date() }),
      delete: (id) => db.remove("accounts", id),
    },
    tokens: {
      save: async (accountId, tokens) =>
        db.upsert("tokens", { accountId, ...(await encryptor.encrypt(tokens)) }),
      get: async (accountId) => {
        const row = await db.findOne("tokens", { accountId });
        return row ? encryptor.decrypt(row) : null;
      },
      update: (accountId, patch) => db.patch("tokens", accountId, patch),
      delete: (accountId) => db.remove("tokens", accountId),
    },
    // …calendars, events, syncCursors, subscriptions follow the same shape
    transaction: (fn) => db.transaction(fn),
  };
}
```

Suggested indexes: `accounts(provider)`, `calendars(accountId)`, `events(calendarId)`, `events(accountId)`, `events(recurringEventId)`, `syncCursors(accountId, scope)` unique, `subscriptions(accountId)`.

Dates cross the boundary as `Date` objects — remember to revive timestamp columns (`expiresAt`, `leaseExpiry`, `expiry`, `createdAt`, `updatedAt`) when reading.
