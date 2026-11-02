---
title: Accounts
description: Connect, inspect, refresh, and disconnect provider accounts.
sidebar:
  order: 3
---

`sdk.accounts` manages the link between your users and their calendar providers. An `Account` is the root of everything else — calendars, events, cursors, and subscriptions all belong to one.

## The Account model

```typescript
interface Account {
  id: string;                 // SDK-generated UUID — use this everywhere
  provider: "google" | "microsoft" | "caldav";
  displayName: string;
  email: string;
  status: "connected" | "disconnected" | "expired" | "error";
  capabilities: CapabilityMap; // snapshot of what this provider supports
  raw: unknown;                // raw provider profile payload
  extensions: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}
```

## API

### `connect(providerKey, options)`

```typescript
const account = await sdk.accounts.connect("google", {
  authInput: { accessToken, refreshToken },
  // authInput: { authorizationCode, redirectUri } also works
  persistTokens: true, // default
});
```

Exchanges/validates credentials, fetches the profile, saves the account and tokens, and returns the `Account`. Throws `VALIDATION_FAILED` if `authInput` has neither an `authorizationCode` nor an `accessToken`, and `CAPABILITY_UNSUPPORTED` if the provider key isn't registered on the SDK. See [Authentication](/guides/authentication/) for the full flow.

### `list()` and `get(accountId)`

```typescript
const accounts = await sdk.accounts.list();
const account = await sdk.accounts.get(accountId); // null if unknown
```

Both read from storage; no network calls.

### `refresh(accountId)`

```typescript
const account = await sdk.accounts.refresh(accountId);
```

Forces a token refresh using the stored refresh token and resets the account status to `connected`. Throws:

- `NOT_FOUND` — unknown account
- `AUTH_EXPIRED` — no refresh token stored, or the provider rejected the refresh (the account is marked `expired`)

You rarely need this — services refresh tokens automatically — but it is useful for health checks or after a user re-consents.

### `getToken(accountId)`

```typescript
const accessToken = await sdk.accounts.getToken(accountId); // string | null
```

Returns a currently valid access token (refreshing first if needed), or `null` if the account can't be authenticated. Handy when you need to call a provider API the SDK doesn't cover — pair it with the preserved `raw` payloads.

### `disconnect(accountId)`

```typescript
await sdk.accounts.disconnect(accountId);
```

Best-effort revokes the access token with the provider, then deletes tokens, sync cursors, subscriptions, and the account itself. Safe to call for an already-deleted account (it's a no-op).

## Account status

| Status | Meaning |
| --- | --- |
| `connected` | Tokens valid (or refreshable); normal operation |
| `expired` | A token refresh failed — the user must re-authenticate via `connect` |
| `disconnected` | Explicitly disconnected |
| `error` | Provider-side failure |

When a service hits an account whose token can't be resolved it throws `AUTH_REQUIRED` — catch it, send the user through OAuth again, and call `connect` with the new tokens.
