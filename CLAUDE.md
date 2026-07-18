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

CI (`.github/workflows/ci.yml`) runs typecheck → lint → build → test. Publishing happens on `v*` tags via `pnpm -r publish` (`release.yml`); `workspace:*` ranges are rewritten at pack time.

## Architecture

Packages (`packages/*` and `packages/providers/*`):

- `core` → `@nandan-varma/calendar-sdk` — provider-agnostic core; knows nothing about vendor APIs
- `providers/google|microsoft|caldav` → provider adapters, each depends on core via `workspace:*`
- `auth` → OAuth flow / token refresh helpers (`createAuthFlow`)
- `tests` → private placeholder for shared test utilities (currently empty)
- `docs/` (repo root, in the workspace) → private Astro Starlight docs site; content in `docs/src/content/docs/`, sidebar in `docs/astro.config.mjs`. `pnpm --filter @nandan-varma/calendar-sdk-docs dev|build`. When changing public API surface, update the matching guide/reference page.

Key seam: **`ProviderAdapter`** in `packages/core/src/adapters/provider.ts`. It groups per-domain method sets (`auth`, `accounts`, `calendars`, `events`, `availability`, `sync`, `subscriptions`) that all take a `TokenSet` as first argument, plus `getCapabilities()` and `createTransport()`. Each provider package exports a factory (`createGoogleProvider`, etc.) returning this interface. Adding a provider should not touch core.

`createCalendarSdk` (`packages/core/src/index.ts`) wires everything:

- Constructs the services (`AccountsService`, `CalendarsService`, `EventsService`, `AvailabilityService`, `SubscriptionsService`, `SyncService` in `src/services/` and `src/sync/`), injecting storage, logger, and a `getToken` closure.
- `getToken` owns token caching and refresh: it checks an in-memory cache, falls back to `storage.tokens`, refreshes expired tokens via the provider's `auth.refreshToken`, and marks the account `expired` on refresh failure. Services never handle refresh themselves.
- Storage is pluggable behind `StorageAdapter` (`src/storage/index.ts`); default is `createMemoryStorage()` — production consumers bring their own.
- Cross-cutting pieces: `src/capabilities/` (per-provider feature flags so unsupported operations fail explicitly), `src/transport/` (fetch wrapper with retry/backoff), `src/hooks/` (event emitter for instrumenting operations), `src/errors/` (`CalendarSdkError` + `ErrorCode`), `src/types/` (canonical domain model re-exported from the package root).

Provider package layout (google is the reference implementation): `src/client.ts` implements the adapter, `src/mappers/` converts vendor payloads ↔ canonical types, `src/types/` holds vendor wire types.

## Conventions and gotchas

- ESM-first: source uses `.js` extensions in relative imports; packages ship both ESM and CJS via tsup.
- Core's vitest config aliases `@nandan-varma/calendar-sdk-google`/`-microsoft` to the providers' `src/index.ts`, so core tests exercise provider *source* without a build step.
- Integration tests hit real APIs — no mocks by design. Credentials come from `.env` (see `.env.example`); `tests/helpers/env.ts` provides `hasGoogleCredentials()`-style guards for skipping when credentials are absent. `tests/setup.ts` loads the `.env` via dotenv.
- Per-package `lint` scripts pass an explicit `--config-path` to the root `biome.json`; keep that pattern when adding a package.
