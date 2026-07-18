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
| [`@nandan-varma/calendar-sdk-mock`](packages/providers/mock) | In-memory provider for tests and examples — no credentials or network calls |
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
    createGoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
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
  start: { dateTime: "2026-08-01T10:00:00Z", timezone: "UTC" },
  end: { dateTime: "2026-08-01T10:30:00Z", timezone: "UTC" },
});

// Free/busy across an account's calendars
const freeBusy = await sdk.availability.freeBusy(account.id, {
  timeMin: new Date(),
  timeMax: new Date(Date.now() + 86400_000),
  calendars: [calendars[0].providerId],
});
```

Swap `createGoogleProvider` for `createMicrosoftProvider` or `createCalDavProvider` and the rest of your code stays identical. A single SDK instance can register more than one provider at once — just add another entry to `providers`.

Want to try it with zero setup? [`examples/quickstart.ts`](examples/quickstart.ts) runs this same flow against `@nandan-varma/calendar-sdk-mock` — no credentials or network access needed:

```bash
pnpm install
pnpm --filter @nandan-varma/calendar-sdk-examples quickstart
```

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

const authorizationUrl = flow.getAuthorizationUrl(); // send the user here
const tokens = await flow.exchangeCode(codeFromCallback); // then call sdk.accounts.connect(...) with these tokens
// flow.refreshToken(...) / flow.revokeToken(...) are also available once you have a stored token
```

See [`examples/google-oauth.ts`](examples/google-oauth.ts) for the full connect flow wired up behind a small HTTP server.

### Testing your integration

[`@nandan-varma/calendar-sdk-mock`](packages/providers/mock) is a fully in-memory `ProviderAdapter` — no network calls, deterministic — so you can exercise your own code against the whole SDK surface without live credentials:

```typescript
import { createCalendarSdk } from "@nandan-varma/calendar-sdk";
import { createMockProvider } from "@nandan-varma/calendar-sdk-mock";

const sdk = createCalendarSdk({ providers: [createMockProvider()] });
```

## Design

- **Providers are adapters.** The core knows nothing about any vendor API; each provider implements one `ProviderAdapter` interface. Adding a provider does not touch the core.
- **Storage is pluggable.** Accounts and token sets live behind a `StorageAdapter`; the default is in-memory, production apps supply their own (Postgres, Redis, …).
- **Sync is incremental.** `sdk.sync` uses Google `syncToken` / Graph delta queries where available.
- **Transport is resilient.** Built-in retry with backoff for rate limits and transient failures; pass `fetch`/`retryOptions` to a provider factory (e.g. `createGoogleProvider({ ..., fetch, retryOptions })`) to override its defaults.
- **Hooks** let you observe/instrument every operation.

See [SPEC.md](SPEC.md) for the full v1 design rationale.

## Documentation

Comprehensive docs (guides for every service, provider setup, storage, sync, webhooks, and full reference) are published at **<https://nandan-varma.github.io/calendar-sdk/>** and live in [`docs/`](docs), built with [Astro Starlight](https://starlight.astro.build):

```bash
pnpm --filter @nandan-varma/calendar-sdk-docs dev    # local docs at http://localhost:4321
pnpm --filter @nandan-varma/calendar-sdk-docs build  # static site in docs/dist
```

## Development

```bash
pnpm install
pnpm build       # build all packages (including the docs site)
pnpm test        # run all test suites
pnpm typecheck
pnpm lint
```

## License

[MIT](LICENSE)
