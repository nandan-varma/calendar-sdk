---
title: Authentication
description: OAuth flows, connecting accounts with codes or tokens, and automatic token refresh.
sidebar:
  order: 2
---

calendar-sdk is bring-your-own-credentials. You run the OAuth flow (or use the helper package), then hand the resulting tokens to `sdk.accounts.connect`. After that, refresh is automatic.

## Two ways to connect an account

`sdk.accounts.connect(providerKey, options)` accepts either an authorization code or ready-made tokens via `options.authInput`:

```typescript
// 1. With an authorization code from your OAuth callback
const account = await sdk.accounts.connect("google", {
  authInput: {
    authorizationCode: code,
    redirectUri: "https://app.example.com/oauth/callback",
  },
});

// 2. With tokens you already have
const account = await sdk.accounts.connect("google", {
  authInput: { accessToken, refreshToken },
});
```

On connect, the SDK:

1. Exchanges the code (if given) via the provider's `auth.exchangeCode`.
2. Fetches the user profile with `provider.accounts.getAccount(tokens)`.
3. Saves an `Account` (status `connected`, capability snapshot, raw profile).
4. Persists the token set — unless you pass `persistTokens: false`.

:::caution
Tokens are only persisted when a **refresh token** is present. For Google, request `access_type: "offline"` and `prompt: "consent"` (the auth helper does this for you) or you may receive no refresh token and the session will die when the access token expires.
:::

## The auth helper package

`@calendar-sdk/auth` gives you the pieces for a web OAuth flow without pulling in a full auth framework:

```typescript
import {
  createAuthFlow,
  createState,
  verifyState,
} from "@calendar-sdk/auth";

const flow = createAuthFlow({
  provider: "google", // or "microsoft"
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
  redirectUri: "https://app.example.com/oauth/callback",
  scopes: ["https://www.googleapis.com/auth/calendar"],
});

// Step 1: redirect the user
const state = createState(); // random hex, store it in the session
res.redirect(flow.getAuthorizationUrl());

// Step 2: in your callback route
if (!verifyState(req.query.state, session.state)) throw new Error("CSRF");
const tokens = await flow.exchangeCode(req.query.code);

// Step 3: hand off to the SDK
const account = await sdk.accounts.connect("google", {
  authInput: {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
  },
});
```

For Google, `createAuthorizationUrl` automatically adds `access_type=offline` and `prompt=consent` so a refresh token is issued.

### Standalone utilities

The package also exports lower-level building blocks:

| Function | Purpose |
| --- | --- |
| `createAuthorizationUrl(options)` | Build the provider's authorization URL |
| `exchangeCodeForTokens({ provider, code, clientId, clientSecret, redirectUri })` | Code → `TokenSet` |
| `refreshToken(options, { refreshToken })` | Refresh an expired token set |
| `revokeToken(provider, accessToken)` | Revoke a token (Google only) |
| `isTokenExpired(token)` | `true` once `expiresAt` has passed |
| `shouldRefreshToken(token, bufferMs?)` | Like `isTokenExpired` but with an expiry buffer (default 60 s) |
| `createTokenManager(options)` | Cached refresh manager for background services |
| `createState()` / `verifyState(state, stored)` | CSRF state helpers (timing-safe comparison) |

### Token manager for background jobs

```typescript
import { createTokenManager } from "@calendar-sdk/auth";

const tokens = createTokenManager({
  provider: "google",
  clientId: process.env.GOOGLE_CLIENT_ID!,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
});

const token = await tokens.getToken(accountId, () => loadRefreshTokenFromDb(accountId));
```

The manager caches token sets per account, refreshes ahead of expiry, and drops the cache entry when a refresh fails.

## Automatic refresh inside the SDK

Once an account is connected, every service call resolves tokens through the SDK's internal `getToken`:

- valid cached token → used directly;
- expired token + refresh token → refreshed via the provider, persisted, cached;
- refresh failure → account status set to `expired`, and the operation throws `AUTH_REQUIRED`.

To force a refresh manually (for example after changing scopes) call `sdk.accounts.refresh(accountId)`; to fetch a raw access token for direct API calls use `sdk.accounts.getToken(accountId)`.

## Disconnecting

```typescript
await sdk.accounts.disconnect(accountId);
```

This best-effort revokes the token with the provider, then deletes the account's tokens, sync cursors, subscriptions, and finally the account record.

## CalDAV

CalDAV servers use HTTP Basic auth, not OAuth: credentials live in the provider config (`serverUrl`, `username`, `password`) and there is nothing to refresh or revoke. See the [CalDAV guide](/providers/caldav/) for how `connect` works there.
