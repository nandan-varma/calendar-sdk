---
title: Hooks
description: Observe and instrument every SDK operation with typed lifecycle events.
sidebar:
  order: 10
---

`sdk.hooks` is a small typed event bus for observability — request timing, sync progress, auth lifecycle, errors, and rate limits. Attach listeners for metrics, tracing, or alerting without touching business logic.

## Subscribing

```typescript
sdk.hooks.on("request", (event) => {
  if (event.type === "request" && event.event === "end") {
    metrics.timing("calendar.request", event.duration ?? 0, {
      provider: event.provider,
      operation: event.operation,
      status: String(event.status ?? 0),
    });
  }
});

// Wildcard: every event type
sdk.hooks.on("*", (event) => log.debug("sdk hook", event));

// One-shot
sdk.hooks.once("error", (event) => notifyOps(event));

// Remove
sdk.hooks.off("request", handler);
```

Callbacks may be sync or async (`(event) => void | Promise<void>`). Exceptions thrown inside a callback are caught and logged, so a broken listener can't break an SDK operation.

## Event types

`HookEvent` is a discriminated union on `type`:

| `type` | `event` values | Notable fields |
| --- | --- | --- |
| `request` | `start`, `end` | `provider`, `operation`, `method`, `path`, `duration`, `status`, `requestId`, `retryCount`, `error` |
| `sync` | `start`, `progress`, `end` | `accountId`, `scope`, `cursorToken`, `created`, `updated`, `deleted`, `duration`, `error` |
| `subscription` | `created`, `renewed`, `expired`, `deleted`, `notification` | `subscription`, `notification` |
| `auth` | `connected`, `refreshed`, `expired`, `revoked`, `error` | `accountId`, `provider`, `error` |
| `error` | — | `operation`, `error` (a `CalendarSdkError`), `retryable`, `retryCount` |
| `rate_limit` | — | `operation`, `retryAfter`, `limit`, `remaining` |

## Supplying your own emitter

By default the SDK creates an internal bus with `createHooks()`. You can pass your own — including the exported `EventEmitter`, which adds async emission and a custom error handler:

```typescript
import { createCalendarSdk, EventEmitter } from "@calendar-sdk/core";

const hooks = new EventEmitter({
  async: true,                              // await each listener in order
  errorHandler: (err) => log.error("hook listener failed", err),
});

const sdk = createCalendarSdk({ providers, hooks });
```

## Example: request tracing

```typescript
sdk.hooks.on("request", (e) => {
  if (e.type !== "request") return;
  if (e.event === "start") {
    spans.start(`${e.provider}.${e.operation}`, { path: e.path });
  } else {
    spans.end(`${e.provider}.${e.operation}`, {
      status: e.status,
      requestId: e.requestId,
      retries: e.retryCount ?? 0,
    });
  }
});

sdk.hooks.on("rate_limit", (e) => {
  if (e.type === "rate_limit") {
    log.warn(`${e.provider} throttled ${e.operation}; retry after ${e.retryAfter}s`);
  }
});
```
