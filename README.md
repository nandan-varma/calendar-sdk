# calendar-sdk

[![npm version](https://img.shields.io/npm/v/@nandan-varma/calendar-sdk.svg)](https://www.npmjs.com/package/@nandan-varma/calendar-sdk)
[![CI](https://github.com/nandan-varma/calendar-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/nandan-varma/calendar-sdk/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@nandan-varma/calendar-sdk.svg)](LICENSE)

One TypeScript API for **Google Calendar, Microsoft Graph (Outlook), and CalDAV/iCloud** — events, calendars, availability, incremental sync, and webhook subscriptions, without vendoring three different SDKs into your app.

An open alternative to paid unified-calendar APIs: bring your own OAuth credentials, keep your users' tokens in your own storage.

## Packages

| Package | What it is |
|---|---|
| [`@nandan-varma/calendar-sdk`](packages/core) | Core: unified services (accounts, calendars, events, availability, subscriptions, sync), storage + hooks + retrying transport |
| [`@nandan-varma/calendar-sdk-google`](packages/providers/google) | Google Calendar provider adapter |
| [`@nandan-varma/calendar-sdk-microsoft`](packages/providers/microsoft) | Microsoft Graph calendar provider adapter |
| [`@nandan-varma/calendar-sdk-caldav`](packages/providers/caldav) | CalDAV provider adapter (iCloud, Fastmail, Nextcloud, …) |
| [`@nandan-varma/calendar-sdk-auth`](packages/auth) | OAuth flow, token refresh, and encrypted token-set helpers |

## Install

```bash
npm install @nandan-varma/calendar-sdk @nandan-varma/calendar-sdk-google
```

## Quick start

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
      }),
    },
  ],
  // storage defaults to in-memory; plug in your database via StorageAdapter
});

// Connect an account (tokens from your OAuth callback)
const account = await sdk.accounts.connect("google", {
  authInput: { accessToken, refreshToken },
});

// Same API for every provider from here on
const calendars = await sdk.calendars.list(account.id);
const events = await sdk.events.list(calendars[0].id, {
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 7 * 86400_000),
});

await sdk.events.create(calendars[0].id, {
  title: "Coffee",
  start: { dateTime: "2026-08-01T10:00:00Z" },
  end: { dateTime: "2026-08-01T10:30:00Z" },
});

// Free/busy across an account's calendars
const freeBusy = await sdk.availability.freeBusy(account.id, {
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 86400_000),
});
```

Swap `createGoogleProvider` for `createMicrosoftProvider` or `createCalDavProvider` and the rest of your code stays identical.

### OAuth helper

```typescript
import { createAuthFlow } from "@nandan-varma/calendar-sdk-auth";

const flow = createAuthFlow({
  provider: "google",
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: "https://app.example.com/oauth/callback",
  scopes: ["https://www.googleapis.com/auth/calendar"],
});
// authorization URL, code exchange, token refresh with expiry buffer…
```

## Design

- **Providers are adapters.** The core knows nothing about any vendor API; each provider implements one `ProviderAdapter` interface. Adding a provider does not touch the core.
- **Storage is pluggable.** Accounts and token sets live behind a `StorageAdapter`; the default is in-memory, production apps supply their own (Postgres, Redis, …).
- **Sync is incremental.** `sdk.sync` uses Google `syncToken` / Graph delta queries where available.
- **Transport is resilient.** Built-in retry with backoff for rate limits and transient failures; bring your own `fetch`.
- **Hooks** let you observe/instrument every operation.

See [SPEC.md](SPEC.md) for the full v1 design rationale.

## Development

```bash
pnpm install
pnpm build       # build all packages
pnpm test        # run all test suites
pnpm typecheck
pnpm lint
```

## License

[MIT](LICENSE)
