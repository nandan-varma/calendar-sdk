# Examples

Copy-pasteable, runnable programs. Install workspace deps at the repo root (`pnpm install`) first.

| Script | What it shows | Needs credentials? |
|---|---|---|
| `pnpm --filter @nandan-varma/calendar-sdk-examples quickstart` | Connect, list calendars, create/list events, free/busy, share | No - uses the in-memory mock provider |
| `pnpm --filter @nandan-varma/calendar-sdk-examples sync-worker` | Full sync → persist cursor → incremental sync loop | No - uses the mock provider |
| `pnpm --filter @nandan-varma/calendar-sdk-examples google-oauth` | Real Google OAuth connect flow via `@calendar-sdk/auth` | Yes - `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` (see root `.env.example`) |

`quickstart.ts` and `sync-worker.ts` use [`@calendar-sdk/mock`](../packages/providers/mock) instead of a real provider, so they run offline with no setup - swap in `createGoogleProvider`/`createMicrosoftProvider`/`createCalDavProvider` and the rest of the code is unchanged.
