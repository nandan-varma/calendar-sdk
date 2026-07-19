export type SubscriptionStatus = 'active' | 'expired' | 'error' | 'paused';
export type SubscriptionRenewalPolicy = 'auto' | 'manual';

export interface Subscription {
  id: string;
  accountId: string;
  provider: string;
  resource: string;
  webhookUrl?: string;
  leaseExpiry: Date;
  secret?: string;
  renewalPolicy: SubscriptionRenewalPolicy;
  lastNotificationAt?: Date;
  lastNotificationStatus?: 'success' | 'failed';
  status: SubscriptionStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface SubscriptionInput {
  accountId: string;
  resource: string;
  webhookUrl?: string;
  leaseDuration?: number;
  secret?: string;
  renewalPolicy?: SubscriptionRenewalPolicy;
}

export interface SubscriptionConfig {
  resource: string;
  webhookUrl?: string;
  leaseDurationSeconds?: number;
  secret?: string;
  retryPolicy?: SubscriptionRetryPolicy;
}

export interface SubscriptionRetryPolicy {
  maxRetries: number;
  backoffMultiplier: number;
  initialDelayMs: number;
}

export interface CreateSubscriptionOptions {
  accountId: string;
  scope: 'calendars' | 'events' | 'all';
  config: SubscriptionConfig;
}

export interface SubscriptionNotification {
  subscriptionId: string;
  accountId: string;
  resource: string;
  timestamp: Date;
  expiration?: Date;
  changes?: SubscriptionChange[];
  /**
   * The verification value the provider echoed back on this notification - Google's
   * `X-Goog-Channel-Token` header, or Microsoft's `clientState` field on the notification
   * payload. Pass it through from your webhook handler so `handleNotification()` can check it
   * against `Subscription.secret`; if the subscription has a `secret` and this doesn't match,
   * the notification is rejected as unverified.
   */
  token?: string;
}

export type SubscriptionChange =
  | { type: 'created'; resourceId: string; resource?: unknown }
  | { type: 'updated'; resourceId: string; resource?: unknown }
  | { type: 'deleted'; resourceId: string };

export interface SubscriptionCapabilityMap {
  create: boolean;
  renew: boolean;
  delete: boolean;
  webhooks: boolean;
  polling: boolean;
  renewal: 'auto' | 'manual' | 'none';
}
