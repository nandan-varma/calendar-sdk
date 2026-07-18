---
title: Transport & retries
description: The shared fetch wrapper — retry policy, backoff, timeouts, and log redaction.
sidebar:
  order: 4
---

All provider HTTP traffic flows through one transport: a `fetch` wrapper with retries, exponential backoff with jitter, timeout handling, and sensitive-value redaction in debug logs.

## Retry behavior

Defaults (exported as `defaultRetryOptions`):

```typescript
{
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ["ECONNRESET", "ETIMEDOUT", "ENOTFOUND", "ENETUNREACH"],
}
```

- Delay for attempt *n* is `min(initialDelayMs · backoffMultiplier^n, maxDelayMs)` plus up to 30 % random jitter.
- A `Retry-After` response header **overrides** the computed backoff (seconds → ms).
- Network-level errors matching `retryableErrors` are retried like retryable statuses.
- When retries are exhausted, the last error is thrown as a `CalendarSdkError` — so any error your code sees has already been through the retry policy.

## Timeouts and cancellation

- Default request timeout: **30 s**, enforced with an internal `AbortController`.
- A caller-provided `AbortSignal` is combined with the timeout signal; either can cancel.
- Cancellation surfaces as a `NETWORK_ERROR` (`"Request was cancelled"`).

## Redaction

Debug logging of request bodies and headers redacts `access_token`, `refresh_token`, `authorization`, `cookie`, and `x-api-key` (recursively), so `minLevel: "debug"` is safe to enable in development.

## Using it directly

Adapter authors (and anyone making provider-native calls) can create a transport:

```typescript
import { createTransport, defaultRetryOptions } from "@nandan-varma/calendar-sdk";

const transport = createTransport("google", {
  baseUrl: "https://www.googleapis.com/calendar/v3",
  timeout: 15_000,
  headers: { Authorization: `Bearer ${accessToken}` },
  retryOptions: { ...defaultRetryOptions, maxRetries: 5 },
  fetch: customFetch,           // optional; defaults to global fetch
});

const { data, status, headers, requestId } = await transport.request<GoogleEventsResponse>({
  method: "GET",
  path: "/calendars/primary/events",
  query: { maxResults: "50" },
});
```

`request` options: `method` (`GET`/`POST`/`PUT`/`PATCH`/`DELETE`, or any custom verb like CalDAV's `PROPFIND`/`REPORT`), `path`, `query`, `headers`, `body`, `responseType` (`"json"` default, or `"text"` for XML/plain-text APIs), `timeout`, `signal`. Object bodies are JSON-serialized automatically (with a `Content-Type: application/json` default, unless you already set one); string bodies are sent as-is. Successful responses parse per `responseType` (204 always → `null`) and expose lower-cased headers plus the provider `requestId` when present.

## Custom fetch

Pass `fetch`/`retryOptions` to a provider factory (e.g. `createGoogleProvider({ ..., fetch: customFetch, retryOptions: { maxRetries: 5 } })`) to route that provider's traffic through a proxy, add instrumentation, or stub responses in tests — each provider builds its own transport from its own config, there's no SDK-wide override. `fetch` must be `fetch`-compatible (`(url, init) => Promise<Response>`).
