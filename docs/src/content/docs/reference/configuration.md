---
title: Configuration
description: Every option accepted by createCalendarSdk and what the returned SDK exposes.
sidebar:
  order: 1
---

## `createCalendarSdk(config)`

```typescript
import { createCalendarSdk } from "@calendar-sdk/core";

const sdk = createCalendarSdk({
  providers: [createGoogleProvider({ ... })],
  storage: myStorageAdapter,        // default: createMemoryStorage()
  logger: myLogger,                 // default: createLogger({ prettyPrint: true })
  loggerOptions: { minLevel: "warn" },
  hooks: myHooks,                   // default: createHooks()
});
```

### `SdkConfig`

| Option | Type | Default | Purpose |
| --- | --- | --- | --- |
| `providers` | `ProviderAdapter[]` | — (required) | One adapter per provider you want to support — each adapter already carries its own `key` |
| `storage` | `StorageAdapter` | in-memory | Persistence for accounts, tokens, calendars, events, cursors, subscriptions — see [Storage](/guides/storage/) |
| `logger` | `Logger` | console logger | Structured logger used by all services |
| `loggerOptions` | `LoggerOptions` | — | Options for the default logger (ignored when `logger` is set) |
| `hooks` | `Hooks` | internal bus | Event bus for observability — see [Hooks](/guides/hooks/) |

`fetch`/`retryOptions` are configured per-provider, not on `createCalendarSdk` — the core never issues HTTP requests itself, only providers do. Pass them to the provider factory: `createGoogleProvider({ clientId, clientSecret, fetch: myFetch, retryOptions: { maxRetries: 5 } })`. See [Transport](/reference/transport/).

### `LoggerOptions`

| Option | Default | |
| --- | --- | --- |
| `minLevel` | `"info"` | `"debug" \| "info" \| "warn" \| "error"` |
| `includeTimestamp` | `true` | Prefix ISO timestamps |
| `includeContext` | `true` | Append structured metadata |
| `redactSensitive` | `true` | Redact token-like values |
| `prettyPrint` | `false` | Human-friendly output |

`createLogger`, `noopLogger` (silence everything), and the `Logger` interface are exported if you want to bridge to pino/winston — a `Logger` is just `debug`/`info`/`warn`/`error` methods taking `(message, meta?)`.

## The returned `CalendarSdk`

```typescript
interface CalendarSdk {
  accounts: AccountsService;          // connect, list, get, refresh, getToken, disconnect
  calendars: CalendarsService;        // list, get, create, update, delete, share
  events: EventsService;              // list, get, create, update, delete, move, duplicate
  availability: AvailabilityService;  // freeBusy, suggest
  subscriptions: SubscriptionsService;// create, renew, delete, list, get, handleNotification, checkExpiry
  sync: SyncService;                  // fullSync, incrementalSync, reconcile, getSyncStatus
  hooks: Hooks;                       // on, off, once, emit
  storage: StorageAdapter;            // direct access to the active storage
  getProvider(key: ProviderKey): ProviderAdapter;
}
```

`getProvider` throws for unregistered keys; it's mainly used to feed `sdk.sync.*` methods and for provider-native escape hatches.

## Multiple providers, one SDK

```typescript
const sdk = createCalendarSdk({
  providers: [
    createGoogleProvider({ ... }),
    createMicrosoftProvider({ ... }),
    createCalDavProvider({ ... }),
  ],
  storage,
});
```

Accounts remember which provider they belong to, so all service calls stay identical regardless of the mix.
