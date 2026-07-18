# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A pnpm workspace monorepo for `@nandan-varma/calendar-sdk` — one TypeScript API over Google Calendar, Microsoft Graph, and CalDAV. See SPEC.md for the full v1 design rationale.

## Commands

```bash
pnpm install
pnpm build              # tsup builds all packages (dual ESM/CJS to dist/)
pnpm typecheck
pnpm lint / pnpm lint:fix       # Biome (not ESLint)
pnpm format / pnpm format:check # Biome (not Prettier)
pnpm test               # unit-level suites in every package
pnpm test:integration   # real-API tests (needs .env credentials)
```

Run tests for one package / one file / one test (nearly all tests live in `packages/core/tests/`):

```bash
pnpm --filter @nandan-varma/calendar-sdk test
cd packages/core && pnpm vitest run tests/basic.test.ts
cd packages/core && pnpm vitest run tests/basic.test.ts -t "test name"
```

Note: the default vitest config in `packages/core/vitest.config.ts` only includes `tests/basic.test.ts`, `tests/unit/**`, and `tests/integration/sdk.test.ts`; the full `tests/integration/**` set runs via `vitest.integration.config.ts` (`pnpm test:integration`).

CI (`.github/workflows/ci.yml`) runs build → typecheck → lint → test, on a Node 22/24 matrix (build must precede typecheck so provider packages can resolve core's built types). Publishing happens on `v*` tags via `pnpm -r publish` (`release.yml`); `workspace:*` ranges are rewritten at pack time.

Package manager is pinned via `packageManager: pnpm@11.13.0` in the root `package.json`; pnpm 11 requires Node >= 22.13 (the `engines.node` field says `>=18.0.0` but is unenforced — use Node 22+ locally).

## Architecture

Packages (`packages/*`, `packages/providers/*`, `examples`, `docs`):

- `core` → `@nandan-varma/calendar-sdk` — provider-agnostic core; knows nothing about vendor APIs
- `providers/google|microsoft|caldav` → real provider adapters, each depends on core via `workspace:*`
- `providers/mock` → `@nandan-varma/calendar-sdk-mock` — fully in-memory `ProviderAdapter` (no network), for tests and examples
- `auth` → OAuth flow / token refresh helpers (`createAuthFlow`)
- `tests` → private placeholder for shared test utilities (currently empty)
- `examples/` (repo root, in the workspace, private) → runnable scripts run via `tsx` (`pnpm --filter @nandan-varma/calendar-sdk-examples <script-name>`, e.g. `quickstart`, `sync-worker`, `google-oauth`). The mock-provider ones run with zero setup; keep them actually executable when touching the public API.
- `docs/` (repo root, in the workspace) → private Astro Starlight docs site; content in `docs/src/content/docs/`, sidebar in `docs/astro.config.mjs`. `pnpm --filter @nandan-varma/calendar-sdk-docs dev|build`. When changing public API surface, update the matching guide/reference page.

Key seam: **`ProviderAdapter`** in `packages/core/src/adapters/provider.ts`. It groups per-domain method sets (`auth`, `accounts`, `calendars`, `events`, `availability`, `sync`, `subscriptions`) that all take a `TokenSet` as first argument, plus `getCapabilities()` and `createTransport()`. `CalendarsProviderMethods.share` is optional — omit it entirely for providers that can't share calendars (report `share: false` in capabilities instead). Each provider package exports a factory (`createGoogleProvider`, etc.) returning this interface; `SdkConfig.providers` is just `ProviderAdapter[]` (each adapter already carries its own `key`, which is `ProviderKey` — the three built-ins or any custom string, so a fourth-party/testing provider doesn't need to touch core). Adding a provider should not touch core.

`createCalendarSdk` (`packages/core/src/index.ts`) wires everything:

- Constructs the services (`AccountsService`, `CalendarsService`, `EventsService`, `AvailabilityService`, `SubscriptionsService`, `SyncService` in `src/services/` and `src/sync/`), injecting storage, logger, and a shared `TokenManager`.
- `src/token-manager.ts`'s `createTokenManager()` is the single source of truth for token caching/refresh: `getToken()` checks an in-memory cache, falls back to `storage.tokens`, refreshes expired tokens via the provider's `auth.refreshToken`, and marks the account `expired` on refresh failure; `refresh()` forces a refresh regardless of cache state (used by `AccountsService.refresh`). Services never handle refresh themselves — don't reintroduce a second copy of this logic in a service.
- `SyncService` methods (`fullSync`, `incrementalSync`, `reconcile`) take `accountId` like every other service — they resolve the provider/token internally via the same `TokenManager`, not a raw `ProviderAdapter` argument. A `SyncCursor` is tied to one calendar's event feed; pass `calendarId` explicitly for multi-calendar accounts or only the last-synced calendar gets a durable cursor.
- Storage is pluggable behind `StorageAdapter` (`src/storage/index.ts`); default is `createMemoryStorage()` — production consumers bring their own.
- Cross-cutting pieces: `src/capabilities/` (per-provider feature flags so unsupported operations fail explicitly), `src/transport/` (`createTransport()` — the shared retrying/backoff fetch wrapper every provider routes its HTTP calls through, so `CalendarSdkError`s and retries are consistent across providers), `src/hooks/` (event emitter for instrumenting operations), `src/errors/` (`CalendarSdkError` + `ErrorCode`), `src/types/` (canonical domain model re-exported from the package root).

Provider package layout (google is the reference implementation): `src/client.ts` implements the adapter, `src/mappers/` converts vendor payloads ↔ canonical types, `src/types/` holds vendor wire types. Each provider's own config accepts `fetch`/`retryOptions` to override its transport (there's no SDK-wide override — the core never issues HTTP requests itself).

## Conventions and gotchas

- ESM-first: source uses `.js` extensions in relative imports; packages ship both ESM and CJS via tsup.
- Core's vitest config aliases `@nandan-varma/calendar-sdk-google`/`-microsoft` to the providers' `src/index.ts`, so core tests exercise provider *source* without a build step.
- Integration tests hit real APIs — no mocks by design. Credentials come from `.env` (see `.env.example`); `tests/helpers/env.ts` provides `hasGoogleCredentials()`-style guards for skipping when credentials are absent. `tests/setup.ts` loads the `.env` via dotenv. For testing SDK-consuming code without real credentials, use `@nandan-varma/calendar-sdk-mock` instead — see `packages/providers/mock/tests/mock.test.ts`.
- `calendars.get(calendarId)`/`events.get(eventId)` read from local storage only and throw `NOT_FOUND` (not return `null`) if that resource hasn't been synced yet — call `calendars.list(accountId)`/`events.list(calendarId)` first.
- Per-package `lint` scripts pass an explicit `--config-path` to the root `biome.json`; keep that pattern when adding a package.
