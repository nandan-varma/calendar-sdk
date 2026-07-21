---
title: Auth package
description: API reference for @calendar-sdk/auth — OAuth flows, token refresh, and CSRF helpers.
sidebar:
  order: 5
---

`@calendar-sdk/auth` contains OAuth utilities for Google and Microsoft. It is optional — provider adapters embed their own auth methods — but useful when you build your own login routes or background token services. Usage patterns are covered in the [Authentication guide](/guides/authentication/); this page is the API surface.

## Flows

### `createAuthFlow(options): AuthFlow`

```typescript
interface AuthFlowOptions {
  provider: "google" | "microsoft";
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  scopes: string[];
}

interface AuthFlow {
  getAuthorizationUrl(): string;
  exchangeCode(code: string): Promise<TokenSet>;
  refreshToken(token: RefreshToken): Promise<TokenSet>;
  revokeToken(accessToken: string): Promise<void>;
}
```

For Google, the authorization URL includes `access_type=offline` and `prompt=consent` so a refresh token is issued. `flow.refreshToken`/`flow.revokeToken` are convenience wrappers around the standalone `refreshToken`/`revokeToken` functions below, bound to this flow's `provider`/`clientId`/`clientSecret` — use them once you have a stored token so you don't have to re-pass those options everywhere.

### `createAuthorizationUrl(options): string`

Standalone URL builder with the same options.

### `exchangeCodeForTokens(options): Promise<TokenSet>`

```typescript
exchangeCodeForTokens({
  provider: "google" | "microsoft",
  code: string,
  clientId: string,
  clientSecret?: string,
  redirectUri: string,
});
```

Posts to the provider token endpoint and returns a normalized `TokenSet` (`accessToken`, `refreshToken?`, `expiresAt?`, `tokenType?`, `scope?`).

## Tokens

### `refreshToken(options, token): Promise<TokenSet>`

```typescript
refreshToken(
  { provider, clientId, clientSecret },   // RefreshOptions
  { refreshToken },                       // RefreshToken
);
```

Keeps the previous refresh token when the provider doesn't rotate it.

### `revokeToken(provider, accessToken): Promise<void>`

Revokes the token at Google's revocation endpoint. Currently a no-op for Microsoft (Graph tokens expire on their own; use Entra session revocation for hard sign-out).

### `isTokenExpired(token): boolean` / `shouldRefreshToken(token, bufferMs = 60000): boolean`

Expiry checks against `token.expiresAt`; `shouldRefreshToken` fires early by `bufferMs` so you refresh before requests start failing. Tokens without `expiresAt` never report expired.

### `createTokenManager(options): TokenManagerHandle`

```typescript
interface TokenManagerHandle {
  getToken(accountId: string, getRefreshToken: () => Promise<RefreshToken | null>): Promise<TokenSet | null>;
  invalidateToken(accountId: string): void;
  clear(): void;
}
```

Per-account cached refresh: returns the cached token while fresh, refreshes through your `getRefreshToken` callback when stale, and evicts the cache entry if a refresh throws.

## CSRF state

```typescript
createState(): string                       // 32 random bytes, hex-encoded
verifyState(state, storedState): boolean    // timing-safe comparison
```

## Types

- `AuthSession` — `{ accountId, provider, tokens, createdAt, expiresAt?, refreshAt? }`
- `EncryptedTokenSet` — the persisted token shape (same fields as `TokenSet`)
- `TokenEncryptor` — `{ encrypt(tokens), decrypt(encrypted) }`; implement this to encrypt tokens at rest inside your [storage adapter](/guides/storage/)
