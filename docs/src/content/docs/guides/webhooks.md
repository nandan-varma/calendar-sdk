---
title: Webhooks & subscriptions
description: Push notifications for calendar changes via Google watch channels and Microsoft Graph subscriptions.
sidebar:
  order: 8
---

`sdk.subscriptions` manages provider push channels — Google Calendar *watch channels* and Microsoft Graph *change notification subscriptions* — so you can react to changes without polling. CalDAV has no webhook support (`capabilities.sync.webhook: false`); poll with [Sync](/guides/sync/) instead.

## The Subscription model

```typescript
interface Subscription {
  id: string;
  accountId: string;
  provider: string;
  resource: string;          // what is being watched (e.g. a calendar)
  webhookUrl?: string;       // your HTTPS endpoint
  leaseExpiry: Date;         // provider-imposed expiry — must be renewed
  secret?: string;           // validation secret (Graph clientState)
  renewalPolicy: "auto" | "manual";
  status: "active" | "expired" | "error" | "paused";
  lastNotificationAt?: Date;
  lastNotificationStatus?: "success" | "failed";
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
```

## Creating a subscription

```typescript
const subscription = await sdk.subscriptions.create(account.id, {
  resource: calendar.providerId,                     // provider calendar id
  webhookUrl: "https://app.example.com/webhooks/calendar",
  leaseDurationSeconds: 60 * 60 * 24 * 3,            // provider-capped
  secret: process.env.WEBHOOK_SECRET,                // echoed back for validation
});
```

Requires the `sync.webhook` capability (`CAPABILITY_UNSUPPORTED` on CalDAV). The webhook endpoint must be publicly reachable over HTTPS — both Google and Microsoft validate it during creation.

## Handling notifications

Provider notifications are thin "something changed" pings. The standard pattern:

1. Receive the POST on your endpoint, validate it (Google channel token / Graph `clientState` against `secret`, and answer Graph's `validationToken` handshake).
2. Record it with the SDK.
3. Run an incremental sync to fetch the actual changes.

```typescript
app.post("/webhooks/calendar", async (req, res) => {
  res.status(202).end(); // acknowledge fast; providers retry slow endpoints

  await sdk.subscriptions.handleNotification({
    subscriptionId,             // from provider headers/body
    accountId,
    resource,
    timestamp: new Date(),
  });

  const cursor = await sdk.storage.syncCursors.get(accountId, "events");
  if (cursor) await sdk.sync.incrementalSync(accountId, cursor);
});
```

`handleNotification` updates the subscription's `lastNotificationAt`/`lastNotificationStatus` bookkeeping and warns on notifications for unknown subscriptions.

## Renewal

Provider leases are short (Graph calendar subscriptions max out at a few days; Google channels expire too), so renewal must be scheduled:

```typescript
// Run periodically, e.g. hourly
const expired = await sdk.subscriptions.checkExpiry();
// marks lapsed subscriptions "expired" and logs a warning 24h before expiry

for (const { subscription } of expired) {
  await sdk.subscriptions.create(subscription.accountId, {
    resource: subscription.resource,
    webhookUrl: subscription.webhookUrl,
  });
}

// Or proactively renew active ones before they lapse:
await sdk.subscriptions.renew(subscriptionId);
```

`renew` extends the lease via the provider and updates `leaseExpiry`; recreate the subscription if renewal fails.

## Other operations

```typescript
await sdk.subscriptions.list(accountId);   // stored subscriptions for an account
await sdk.subscriptions.get(id);           // one subscription, or null
await sdk.subscriptions.delete(id);        // stop remotely (best effort) + remove locally
```

## Observing subscription activity

Subscription lifecycle events (`created`, `renewed`, `expired`, `deleted`, `notification`) are also emitted on the [hooks](/guides/hooks/) bus as `type: "subscription"` events.
