Below is a v1-oriented specification for `calendar-sdk` focused on the best possible developer experience, while staying faithful to what the major calendar ecosystems actually support.

## What the providers force you to support

Google Calendar is not just CRUD over events: the API has separate resource families for calendars, calendar lists, events, ACLs, free/busy, settings, and channels, and it supports incremental sync via `syncToken` plus push-style watch channels. Google also exposes conference-data handling as an explicit versioned concern and has separate scope sets for read-only, write, free/busy, and settings access. ([Google for Developers][1])

Microsoft Graph similarly treats calendars as a first-class resource with CRUD, free/busy, and meeting-time suggestions, and it supports delta query plus change notifications via subscriptions. Permissions are granular and vary between delegated and application scenarios, so the SDK has to expose auth mode and scope/permission intent instead of hiding it. ([Microsoft Learn][2])

Apple Calendar is best approached through CalDAV rather than a separate public “Apple Calendar API.” Apple’s own documentation frames calendar account setup around CalDAV-compliant servers, and iCloud calendars are based on CalDAV/CardDAV standards. That means a real v1 must support standards-based calendar access, not only provider-specific REST APIs. ([Apple Support][3])

CalDAV and iCalendar are the standards backbone for interoperability: CalDAV defines calendar access over WebDAV, while iCalendar defines the data model for events, free/busy, and recurrence-related information. ([IETF Datatracker][4])

For packaging, Node.js supports dual CommonJS/ESM delivery through conditional exports, so a polished library should ship a modern ESM-first surface with compatibility for require-based consumers where needed. ([nodejs.org][5])

---

# v1 product definition

`calendar-sdk` v1 should be a **multi-provider calendar integration platform** with three strong guarantees:

1. **One canonical model** for calendars, events, availability, sync cursors, and subscriptions.
2. **Provider adapters** for Google, Microsoft, and CalDAV/Apple-style accounts.
3. **Lossless provider preservation** so raw payloads and provider-only fields are never discarded.

The right mental model is not “one universal calendar API.” It is “one stable SDK core with provider capabilities exposed explicitly.”

---

# v1 developer experience goals

## 1) Minimal startup cost

A developer should be able to connect a provider and fetch calendars in a few lines.

```ts
const sdk = createCalendarSdk({
  providers: [googleProvider(), microsoftProvider(), caldavProvider()],
  storage: postgresStorage(pool),
});

const account = await sdk.accounts.connect('google', {
  authorizationCode,
  redirectUri,
});

const calendars = await sdk.calendars.list(account.id);
```

## 2) Strong typing with low ceremony

* Narrow input/output types
* Discriminated unions for event/time/recur/sync errors
* Provider-specific extras accessible but not required
* No giant `any` surfaces

## 3) Explicit capability discovery

Never force developers to discover unsupported behavior by trial and error. The SDK should say:

* this provider supports webhook sync
* this provider supports event attachments
* this provider supports conference data
* this provider does not support calendar sharing in the same way

## 4) Good defaults, not hidden magic

The SDK should provide:

* retries with backoff
* pagination helpers
* token refresh
* cursor persistence
* webhook renewal helpers
* sane logging redaction

## 5) Provider-native escape hatches

The SDK should expose:

* raw payload access
* vendor-specific fields
* provider-specific request options
* custom transport hooks
* custom auth hooks

That is essential for production integrations.

---

# v1 scope: what must exist

## A. Core package

### `calendar-sdk`

Contains:

* canonical types
* SDK factory
* adapter interfaces
* error model
* sync primitives
* capability model
* transport abstractions
* event emitter/hooks
* serialization helpers

### `calendar-sdk/auth`

Contains:

* OAuth helper utilities
* refresh token management helpers
* token encryption interfaces
* auth session types
* auth flow utilities for web apps and background services

### Provider packages

* `calendar-sdk/google`
* `calendar-sdk/microsoft`
* `calendar-sdk/caldav`

Optional later:

* `calendar-sdk/ics`
* `calendar-sdk/exchange`
* `calendar-sdk/custom`

---

# Canonical models required in v1

## 1) Account

Represents a connected identity on a provider.

Required fields:

* `id`
* `provider`
* `displayName`
* `email`
* `status`
* `capabilities`
* `raw`
* `extensions`

## 2) Calendar

Required fields:

* `id`
* `accountId`
* `providerId`
* `name`
* `description`
* `timezone`
* `color`
* `primary`
* `readOnly`
* `hidden`
* `accessRole`
* `capabilities`
* `raw`
* `extensions`

## 3) Event

Required fields:

* `id`
* `accountId`
* `calendarId`
* `providerId`
* `iCalUid`
* `title`
* `description`
* `location`
* `start`
* `end`
* `allDay`
* `timezone`
* `status`
* `transparency`
* `visibility`
* `attendees`
* `organizer`
* `reminders`
* `recurrence`
* `recurrenceMaster`
* `recurringEventId`
* `occurrenceId`
* `exceptions`
* `conference`
* `attachments`
* `etag`
* `version`
* `createdAt`
* `updatedAt`
* `deletedAt`
* `raw`
* `extensions`

## 4) Availability / free-busy

Required fields:

* time window
* calendars or users
* returned blocks
* free/busy/tentative/unknown classification
* timezone awareness

## 5) Sync cursor

Required fields:

* provider
* accountId
* scope
* token
* expiry
* metadata

## 6) Subscription / webhook lease

Required fields:

* provider
* resource scope
* lease expiry
* secret/validation data
* renewal policy
* last notification timestamp
* status

---

# Capability model for v1

Every account and every calendar should expose capabilities so the app can feature-detect cleanly.

```ts
interface CapabilityMap {
  calendars: {
    list: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    share: boolean;
  };
  events: {
    list: boolean;
    create: boolean;
    update: boolean;
    delete: boolean;
    move: boolean;
    duplicate: boolean;
    attachments: boolean;
    conferenceData: boolean;
  };
  sync: {
    incremental: boolean;
    webhook: boolean;
    polling: boolean;
  };
  availability: {
    freeBusy: boolean;
    suggestedTimes: boolean;
  };
}
```

This is not optional. It is the key to a clean DX across Google, Microsoft, and CalDAV.

---

# Public API required for v1

## 1) SDK factory

```ts
const sdk = createCalendarSdk({
  providers: [
    googleProvider(...),
    microsoftProvider(...),
    caldavProvider(...),
  ],
  storage,
  logger,
  fetch,
});
```

## 2) Accounts

```ts
sdk.accounts.connect(providerKey, authInput);
sdk.accounts.list();
sdk.accounts.get(accountId);
sdk.accounts.refresh(accountId);
sdk.accounts.disconnect(accountId);
```

## 3) Calendars

```ts
sdk.calendars.list(accountId, query?);
sdk.calendars.get(calendarId);
sdk.calendars.create(accountId, input);
sdk.calendars.update(calendarId, patch);
sdk.calendars.delete(calendarId);
sdk.calendars.share(calendarId, options);
```

## 4) Events

```ts
sdk.events.list(calendarId, query?);
sdk.events.get(eventId);
sdk.events.create(calendarId, input, options?);
sdk.events.update(eventId, patch, options?);
sdk.events.delete(eventId, options?);
sdk.events.move(eventId, targetCalendarId);
sdk.events.duplicate(eventId, targetCalendarId);
```

## 5) Availability

```ts
sdk.availability.freeBusy(accountId, query);
sdk.availability.suggest(accountId, query);
```

## 6) Sync

```ts
sdk.sync.full(accountId, options?);
sdk.sync.incremental(accountId, cursor, options?);
sdk.sync.reconcile(accountId, scope, options?);
```

## 7) Webhooks / subscriptions

```ts
sdk.subscriptions.create(accountId, scope, webhookConfig);
sdk.subscriptions.renew(subscriptionId);
sdk.subscriptions.delete(subscriptionId);
sdk.subscriptions.list(accountId);
```

---

# What v1 must support in practice

## 1) Authentication and account linking

### Required behaviors

* OAuth-based user consent for Google and Microsoft.
* Token refresh.
* Secure secret storage.
* Account reauthorization flows.
* Clear errors when auth is missing, expired, or revoked.
* Support delegated and service/app-only modes where the provider allows them.

### DX requirement

Provide one auth object per provider, not one magical universal auth shape.

Why: Microsoft permissions differ substantially between delegated and application access, and Google uses explicit scopes for readonly, write, free/busy, and settings access. ([Microsoft Learn][6])

---

## 2) Calendar CRUD

### Required operations

* list calendars
* get calendar
* create calendar
* update calendar
* delete calendar
* support primary calendars and secondary calendars
* support read-only calendars
* support calendar sharing metadata where provider allows it

### DX requirement

The SDK should normalize calendar metadata, but also preserve provider access roles and sharing state.

Google explicitly models calendar list access and ACL roles; Microsoft has calendars and calendar permissions as separate concerns; CalDAV generally depends on server capabilities and access controls. ([Google for Developers][7])

---

## 3) Event CRUD

### Required operations

* list events
* get event
* create event
* update event
* delete event
* move event
* duplicate event

### Required event features

* all-day events
* timezone-aware events
* attendees
* organizer
* reminders
* recurrence
* exceptions / overrides
* cancellation status
* attachments
* conference data where supported

### DX requirement

Make event input objects ergonomic, but do not hide the complexity of recurrence or time zones.

Google event creation has explicit conference-data versioning. Microsoft event resources expose extensions, subscriptions, and delta handling. CalDAV/iCalendar require proper recurrence and time-zone handling. ([Google for Developers][8])

---

## 4) Recurrence support

This must be a serious part of v1, not an afterthought.

### Required capabilities

* RRULE support
* RDATE support
* EXDATE support
* recurring master event
* instance expansion within a query window
* detached instance handling
* cancelled instance handling
* DST-safe expansion
* timezone-preserving serialization

### DX requirement

Give developers two views:

* canonical recurrence object for writes
* expanded occurrences for reads

Do not force them to manually reconstruct recurring series.

This is essential because iCalendar is the standard recurrence/data model underpinning CalDAV and other interoperable calendar systems. ([IETF Datatracker][9])

---

## 5) Free/busy and scheduling

### Required operations

* free/busy query
* optional suggested times
* support multiple calendars or people in one query
* timezone selection
* support provider fallbacks

### DX requirement

`freeBusy` should be a first-class API, not something hidden behind event queries.

Google has a dedicated free/busy endpoint. Microsoft Graph exposes free/busy schedule information and meeting-time suggestions. ([Google for Developers][10])

---

## 6) Sync and change tracking

This is one of the most important v1 requirements.

### Required behaviors

* full sync
* incremental sync
* cursor persistence
* cursor invalidation handling
* deletion propagation
* pagination handling
* resync on expiration
* reconciliation mode after missed webhooks

### Provider-specific behavior to accommodate

* Google incremental sync uses `syncToken`; expired tokens can require a full resync and Google can return `410 Gone` when the token is no longer valid. Google also supports watch channels for push-style notifications. ([Google for Developers][11])
* Microsoft Graph delta query is designed for incremental synchronization, and subscriptions provide change notifications. ([Microsoft Learn][12])
* CalDAV should support polling or sync-property-based strategies depending on the server. The SDK should treat this as a capability rather than assuming webhook parity with Google or Microsoft. ([IETF Datatracker][4])

### DX requirement

Expose sync as a durable service concept, not a one-off method call.

---

## 7) Webhooks / subscriptions

### Required behaviors

* create subscription
* renew subscription
* delete subscription
* validate webhook endpoint
* process notifications
* detect lost notifications
* trigger recovery sync
* surface expiry warnings

### DX requirement

The SDK should manage subscription lifecycle separately from event CRUD so app developers are not hand-rolling lease renewal logic.

Google watch channels and Microsoft subscriptions are both lease-like, expiring constructs rather than permanent connections. ([Google for Developers][13])

---

## 8) Permissions and sharing

### Required support

* read-only access
* read/write access
* free/busy-only access
* shared calendars
* delegated calendars
* owner vs writer vs reader distinction where possible

### DX requirement

Make permission intent explicit at connect time and reflect it in the returned account/capability metadata.

Google exposes ACL roles like `owner`, `writer`, `reader`, and `freeBusyReader`. Microsoft supports shared and delegated Outlook calendars with distinct permission models. ([Google for Developers][7])

---

## 9) Raw payload preservation

This is mandatory.

### Required fields on every normalized object

* `raw`
* `extensions`
* provider identity fields
* provider version or ETag when available

### DX requirement

A developer should always be able to access the exact provider payload that produced the normalized object.

This matters because Google, Microsoft, and CalDAV all carry provider-specific information that cannot be safely flattened away. ([Google for Developers][14])

---

## 10) Error handling

### Required normalized error codes

* `AUTH_REQUIRED`
* `AUTH_EXPIRED`
* `PERMISSION_DENIED`
* `NOT_FOUND`
* `CONFLICT`
* `RATE_LIMITED`
* `CAPABILITY_UNSUPPORTED`
* `VALIDATION_FAILED`
* `SYNC_CURSOR_EXPIRED`
* `SUBSCRIPTION_EXPIRED`
* `NETWORK_ERROR`
* `PROVIDER_ERROR`

### Error payload

Each error should include:

* provider key
* HTTP status
* provider error code
* request ID
* retry hint
* raw error payload
* human-readable remediation message

### DX requirement

Errors should be actionable. “Google sync token expired; resync required” is good. “Provider error” is not.

Google’s error docs explicitly distinguish HTTP-level and body-level details, which is why the SDK should normalize but not flatten error data. ([Google for Developers][15])

---

## 11) Retry, throttling, and resiliency

### Required behavior

* exponential backoff with jitter
* respect `Retry-After`
* retry transient network and server failures
* detect rate limiting
* circuit-breaker option for repeated provider failures
* per-provider retry policy override

### DX requirement

The default SDK should be safe to use in production without forcing every consumer to implement retry logic themselves.

This matters because both Google and Microsoft expose quota/throttle behavior and transient failure modes in their APIs. ([Google for Developers][15])

---

## 12) Transport and runtime

### Required runtime support

* Node.js LTS
* ESM-first
* CJS compatibility through conditional exports if shipped
* injectable fetch
* proxy support
* timeout support
* user agent / client info injection
* tracing headers

### DX requirement

The SDK should not require frameworks, browsers, or a specific HTTP client.

Node supports conditional exports and dual module packaging, so this is a clean packaging strategy for modern consumers. ([nodejs.org][5])

---

## 13) Storage requirements

A production-grade v1 should not assume ephemeral memory.

### Persisted data

* connected accounts
* session tokens
* calendars
* events
* sync cursors
* webhook subscriptions
* provider ID mappings
* webhook secrets
* audit events

### Required storage adapters

* in-memory
* PostgreSQL
* Redis or similar cache layer
* encrypted local file store for development

### DX requirement

The SDK should run out of the box in memory, but offer straightforward production storage adapters.

---

## 14) Observability

### Required hooks

* request start/end
* sync start/end
* subscription renewal events
* error events
* rate-limit events
* auth refresh events
* webhook receive/verify events

### Required metadata

* provider
* account
* calendar
* operation
* request ID
* duration
* retry count

### DX requirement

Provide a structured logger interface and optional OpenTelemetry-friendly hooks. This should be built in, not bolted on later.

---

## 15) Security

### Required rules

* encrypt refresh tokens and secrets at rest
* redact sensitive fields from logs
* separate tenant namespaces
* isolate webhook secrets
* support least-privilege scopes
* do not serialize access tokens in debug output

### Apple/CalDAV implication

Apple notes that iCloud contacts/calendars use standards like CalDAV/CardDAV and do not provide built-in end-to-end encryption. That is a meaningful reminder that security must be treated at the application layer, not assumed from the backend. ([Apple Support][16])

---

# v1 provider matrix

| Provider                  |             v1 support | Important nuance                                                                                                                                             |
| ------------------------- | ---------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Google Calendar           |                    Yes | Separate resources for events, calendars, ACL, free/busy, channels, and settings; incremental sync and watch channels are core. ([Google for Developers][1]) |
| Microsoft Outlook / Graph |                    Yes | Delta query and subscriptions are core; free/busy and meeting suggestions are first-class. ([Microsoft Learn][12])                                           |
| Apple Calendar / iCloud   |        Yes, via CalDAV | Support should be CalDAV-first, not Apple-REST-first. ([Apple Support][3])                                                                                   |
| Generic CalDAV            |                    Yes | Important for enterprise and self-hosted deployments. ([IETF Datatracker][4])                                                                                |
| ICS feed                  | Optional in v1 or v1.1 | Useful for read-only interoperability, but not a full provider.                                                                                              |

---

# v1 DX rules that should be non-negotiable

## 1) Single entrypoint, small surface

No developer should need to learn five different packages to do the first useful thing.

## 2) Opinionated defaults

* default retry policy
* default pagination helper
* default JSON serialization
* default token refresh
* default logging shape

## 3) Provider-specific escape hatches

Every adapter should allow:

* raw request headers
* provider-specific options
* raw payload inspection
* vendor-specific fields

## 4) Great error messages

Errors must tell the developer:

* what failed
* why it failed
* whether they can retry
* whether they need to re-auth
* whether the capability is unsupported

## 5) Discoverability

The public API should be organized by nouns:

* accounts
* calendars
* events
* availability
* sync
* subscriptions

## 6) Narrow, stable types

Use stable exported types and avoid leaking internal adapter implementation types into the public API.

## 7) Progressive adoption

A developer should be able to start with:

* list calendars
* read events
* create events

Then later add:

* sync
* webhooks
* availability
* sharing
* provider-specific fields

---

# v1 installation and packaging requirements

## Package export strategy

Use:

* `exports`
* conditional exports
* typed entrypoints
* subpath exports per provider

### Recommended layout

```json
{
  "name": "calendar-sdk",
  "type": "module",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "require": "./dist/index.cjs"
    },
    "./google": {
      "types": "./dist/google.d.ts",
      "import": "./dist/google.js",
      "require": "./dist/google.cjs"
    }
  }
}
```

Node’s package documentation supports this approach for ESM/CJS interoperability. ([nodejs.org][5])

---

# v1 documentation requirements

The docs are part of the product.

## Must-have docs

* quickstart
* provider setup guides
* auth flow guides
* sync guide
* webhook guide
* error handling guide
* timezone guide
* recurrence guide
* sharing/permissions guide
* migration guide
* provider comparison matrix
* production deployment checklist
* troubleshooting page

## Must-have examples

* Next.js / web OAuth connection
* Node backend service account / daemon pattern
* sync worker with storage
* webhook receiver
* free-busy lookup
* recurring event creation
* CalDAV setup example

## DX requirement

Every example should be copy-pastable and use real types.

---

# v1 testing requirements

## Unit tests

* time conversion
* recurrence expansion
* event normalization
* error mapping
* capability detection
* request serialization

## Integration tests

* Google sandbox tenant
* Microsoft test tenant
* CalDAV test server
* webhook round-trip tests
* sync cursor expiration tests

## Contract tests

* golden fixtures per provider
* snapshot tests for raw-to-canonical mappings
* no-loss round-trip tests for raw payload retention

## DX requirement

Ship a mock provider/testing harness so app developers can test their integration logic without live provider credentials.

---

# v1 acceptance criteria

`calendar-sdk` v1 is ready when all of the following are true:

1. A developer can connect Google, Microsoft, and CalDAV accounts with a small, typed API.
2. Calendar and event CRUD work reliably with provider-specific quirks hidden behind a stable abstraction.
3. Recurrence, all-day events, attendees, time zones, and exceptions are handled correctly.
4. Free/busy works across providers that support it.
5. Incremental sync works for Google and Microsoft, and polling/fallback works for CalDAV.
6. Webhooks/subscriptions are supported where available and are renewable.
7. Raw provider data is preserved.
8. Provider capabilities are discoverable.
9. Errors are normalized and actionable.
10. The package ships clean ESM/CJS-compatible output with complete types.
11. The library is documented, testable, and production-ready without hidden setup.

---

# Recommended v1 product shape

If the goal is best-in-class DX, the v1 should be intentionally narrow in public surface area but deep in operational correctness:

* **one canonical model**
* **one adapter contract**
* **one sync model**
* **one subscription model**
* **one error model**
* **one storage abstraction**
* **provider packages for Google, Microsoft, and CalDAV**
* **full raw-payload preservation**
* **explicit capability discovery**

That gives developers a simple mental model without sacrificing the complexity the providers demand.

If useful, I can turn this into a full v1 implementation spec with exact TypeScript interfaces, package.json exports, and a repository structure.

[1]: https://developers.google.com/workspace/calendar/api/v3/reference?utm_source=chatgpt.com "API Reference | Google Calendar"
[2]: https://learn.microsoft.com/en-us/graph/api/resources/calendar-overview?view=graph-rest-1.0&utm_source=chatgpt.com "Working with calendars and events using the ..."
[3]: https://support.apple.com/guide/deployment/calendar-declarative-configuration-depf0ad6bc01/web?utm_source=chatgpt.com "Calendar declarative configuration for Apple devices"
[4]: https://datatracker.ietf.org/doc/html/rfc4791?utm_source=chatgpt.com "RFC 4791 - Calendaring Extensions to WebDAV (CalDAV)"
[5]: https://nodejs.org/api/packages.html?utm_source=chatgpt.com "Modules: Packages | Node.js v26.1.0 Documentation"
[6]: https://learn.microsoft.com/en-us/graph/permissions-reference?utm_source=chatgpt.com "Microsoft Graph permissions reference"
[7]: https://developers.google.com/workspace/calendar/api/v3/reference/calendarList/list?utm_source=chatgpt.com "CalendarList: list | Google Calendar"
[8]: https://developers.google.com/workspace/calendar/api/v3/reference/events/insert?utm_source=chatgpt.com "Events: insert | Google Calendar"
[9]: https://datatracker.ietf.org/doc/html/rfc5545?utm_source=chatgpt.com "RFC 5545 - Internet Calendaring and Scheduling Core ..."
[10]: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query?utm_source=chatgpt.com "Freebusy: query | Google Calendar"
[11]: https://developers.google.com/workspace/calendar/api/v3/reference/events/list?utm_source=chatgpt.com "Events: list | Google Calendar"
[12]: https://learn.microsoft.com/en-us/graph/delta-query-overview?utm_source=chatgpt.com "Use delta query to track changes in Microsoft Graph data"
[13]: https://developers.google.com/resources/api-libraries/documentation/calendar/v3/python/latest/calendar_v3.acl.html?utm_source=chatgpt.com "acl()"
[14]: https://developers.google.com/workspace/calendar/api/v3/reference/events?utm_source=chatgpt.com "Events | Google Calendar"
[15]: https://developers.google.com/workspace/calendar/api/guides/errors?utm_source=chatgpt.com "Handle API errors | Google Calendar"
[16]: https://support.apple.com/en-us/102651?utm_source=chatgpt.com "iCloud data security overview"
