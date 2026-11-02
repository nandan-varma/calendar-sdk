---
title: Writing a provider adapter
description: Implement the ProviderAdapter interface to add a new calendar backend without touching the core.
sidebar:
  order: 3
---

A provider adapter is pure translation: canonical types in, vendor wire format out. The core never changes when you add one. The Google package (`packages/providers/google`) is the reference implementation — a factory in `client.ts`, vendor wire types in `types/`, and canonical↔vendor mappers in `mappers/`.

## The interface

```typescript
import type { ProviderAdapter } from "@calendar-sdk/core";

interface ProviderAdapter {
  readonly key: ProviderKey; // "google" | "microsoft" | "caldav", or any custom string for a third-party/testing provider
  readonly displayName: string;

  auth: AuthProviderMethods;
  accounts: AccountsProviderMethods;
  calendars: CalendarsProviderMethods;
  events: EventsProviderMethods;
  availability: AvailabilityProviderMethods;
  sync: SyncProviderMethods;
  subscriptions: SubscriptionsProviderMethods;

  getCapabilities(): CapabilityMap;
  createTransport(): Transport;
}
```

Every data method takes a `TokenSet` as its first argument — adapters are stateless with respect to accounts; the core resolves and refreshes tokens.

## Method groups

```typescript
interface AuthProviderMethods {
  createAuthorizationUrl(options: CreateAuthUrlOptions): Promise<string>;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken(token: RefreshToken): Promise<TokenSet>;
  revokeToken(token: string): Promise<void>;
}

interface AccountsProviderMethods {
  getAccount(token: TokenSet): Promise<Account>; // profile fetch
}

interface CalendarsProviderMethods {
  list(token, query?): Promise<Paginated<Calendar>>;
  get(token, id): Promise<Calendar>;
  create(token, input): Promise<Calendar>;
  update(token, id, patch): Promise<Calendar>;
  delete(token, id): Promise<void>;
  share?(token, id, input: ShareCalendarInput): Promise<void>; // omit entirely if the provider can't share (report `share: false`)
}

interface EventsProviderMethods {
  list(token, calendarId, query?): Promise<Paginated<CalendarEvent>>;
  get(token, calendarId, id): Promise<CalendarEvent>;
  create(token, calendarId, input, opts?): Promise<CalendarEvent>;
  update(token, calendarId, id, patch, opts?): Promise<CalendarEvent>;
  delete(token, calendarId, id, opts?): Promise<void>;
  move(token, eventId, sourceCalendarId, targetCalendarId): Promise<CalendarEvent>;
  duplicate(token, eventId, targetCalendarId): Promise<CalendarEvent>;
  expandRecurrence(token, calendarId, eventId, timeMin, timeMax): Promise<ExpandedOccurrence[]>;
}

interface AvailabilityProviderMethods {
  freeBusy(token, query): Promise<FreeBusyResult>;
  suggestMeeting(token, query): Promise<SuggestMeetingResult>;
}

interface SyncProviderMethods {
  fullSync(token, calendarId, options?): Promise<SyncResult>;
  incrementalSync(token, calendarId, cursor): Promise<SyncResult>;
}

interface SubscriptionsProviderMethods {
  create(token, config): Promise<Subscription>;
  renew(token, subscriptionId): Promise<Subscription>;
  delete(token, subscriptionId): Promise<void>;
  list(token, accountId): Promise<Subscription[]>;
  get(token, subscriptionId): Promise<Subscription>;
  validateWebhook?(webhookUrl, validationToken?): Promise<boolean>;
}
```

## Ground rules

1. **Declare honest capabilities.** `getCapabilities()` is checked by services *before* calling you. If you report `webhook: false`, your `subscriptions` methods will never be invoked — you can throw `errors.capabilityUnsupported(...)` in the bodies.
2. **Map errors with `mapHttpError`.** Convert non-OK responses into `CalendarSdkError`s so `retryable`, `code`, and remediation behave consistently:
   ```typescript
   import { mapHttpError } from "@calendar-sdk/core";
   if (!response.ok) {
     throw mapHttpError(response.status, "google", await response.json().catch(() => null));
   }
   ```
3. **Preserve payloads.** Set `raw` to the untouched vendor resource and put provider-only fields in `extensions`. The lossless-preservation guarantee is what makes escape hatches possible.
4. **Use the shared transport for retries.** `createTransport(providerKey, { baseUrl, retryOptions }, logger)` (exported from the core) gives you backoff, `Retry-After` handling, timeouts, and redacted debug logging — see [Transport](/reference/transport/).
5. **Ids belong to the core.** Return canonical objects with the vendor id in `providerId`; services assign/preserve the SDK `id` and `accountId`/`calendarId` links.
6. **Signal cursor expiry.** In `incrementalSync`, translate the vendor's "token too old" response (Google 410, Graph `syncStateNotFound`) into either a thrown `SYNC_CURSOR_EXPIRED` error or a `SyncResult` with `expiredToken: true`.

## Skeleton

```typescript
import type { ProviderAdapter, Logger } from "@calendar-sdk/core";

export interface MyProviderConfig {
  clientId: string;
  clientSecret?: string;
  redirectUri?: string;
  logger?: Logger;
}

export function createMyProvider(config: MyProviderConfig): ProviderAdapter {
  return {
    key: "my-provider", // any string - ProviderKey accepts custom keys alongside the three built-ins
    displayName: "My Calendar Server",
    auth: { /* createAuthorizationUrl, exchangeCode, refreshToken, revokeToken */ },
    accounts: { /* getAccount */ },
    calendars: { /* list, get, create, update, delete */ },
    events: { /* list, get, create, update, delete, move, duplicate, expandRecurrence */ },
    availability: { /* freeBusy, suggestMeeting */ },
    sync: { /* fullSync, incrementalSync */ },
    subscriptions: { /* create, renew, delete, list, get */ },
    getCapabilities: () => ({
      calendars: { create: true, update: true, delete: true, share: false, manageNotifications: false },
      events: { list: true, create: true, update: true, delete: true, move: false, duplicate: false, attachments: false, conferenceData: false },
      sync: { incremental: false, webhook: false, polling: true },
      availability: { freeBusy: true, suggestedTimes: false },
    }),
    createTransport: () => createTransport("caldav", { baseUrl: "https://api.example.com" }),
  };
}
```

:::note
Want to try your adapter, or test code that depends on the SDK, without live credentials? `@calendar-sdk/mock` (`packages/providers/mock`) is a complete in-memory `ProviderAdapter` you can read as a second reference implementation alongside Google's.
:::
