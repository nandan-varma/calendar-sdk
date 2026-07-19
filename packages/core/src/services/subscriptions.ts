import type {
  Subscription,
  SubscriptionConfig,
  SubscriptionInput,
  SubscriptionNotification,
} from '../types/subscription.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import type { Hooks } from '../hooks/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { randomUUID } from 'node:crypto';

export class SubscriptionsService {
  private storage: StorageAdapter;
  private getToken: (accountId: string) => Promise<TokenSet | null>;
  private getProvider: (providerKey: ProviderKey) => ProviderAdapter;
  private logger: Logger;
  private hooks: Hooks;

  constructor(
    storage: StorageAdapter,
    getToken: (accountId: string) => Promise<TokenSet | null>,
    getProvider: (providerKey: ProviderKey) => ProviderAdapter,
    logger: Logger,
    hooks: Hooks
  ) {
    this.storage = storage;
    this.getToken = getToken;
    this.getProvider = getProvider;
    this.logger = logger;
    this.hooks = hooks;
  }

  async create(accountId: string, config: SubscriptionConfig): Promise<Subscription> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.sync;
    if (!caps.webhook) {
      throw errors.capabilityUnsupported('Webhooks', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Creating subscription', { accountId, resource: config.resource });

    const created = await provider.subscriptions.create(token, config);

    const subscription: Subscription = {
      ...created,
      id: created.id || randomUUID(),
      accountId,
      provider: account.provider,
      renewalPolicy: 'auto',
      status: 'active',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await this.storage.subscriptions.save(subscription);

    this.logger.info('Subscription created', { subscriptionId: subscription.id });
    this.hooks.emit({
      type: 'subscription',
      event: 'created',
      provider: account.provider,
      accountId,
      subscription,
    });

    return subscription;
  }

  async renew(subscriptionId: string): Promise<Subscription> {
    const subscription = await this.storage.subscriptions.get(subscriptionId);
    if (!subscription) {
      throw errors.notFound(undefined, 'Subscription not found');
    }

    const account = await this.storage.accounts.get(subscription.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(subscription.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Renewing subscription', { subscriptionId });

    const renewed = await provider.subscriptions.renew(token, subscriptionId);

    const updated: Subscription = {
      ...subscription,
      leaseExpiry: renewed.leaseExpiry,
      status: 'active',
      updatedAt: new Date(),
    };

    await this.storage.subscriptions.save(updated);

    this.logger.info('Subscription renewed', { subscriptionId, newExpiry: renewed.leaseExpiry });
    this.hooks.emit({
      type: 'subscription',
      event: 'renewed',
      provider: account.provider,
      accountId: subscription.accountId,
      subscription: updated,
    });

    return updated;
  }

  async delete(subscriptionId: string): Promise<void> {
    const subscription = await this.storage.subscriptions.get(subscriptionId);
    if (!subscription) {
      return;
    }

    const account = await this.storage.accounts.get(subscription.accountId);
    if (!account) {
      await this.storage.subscriptions.delete(subscriptionId);
      this.hooks.emit({
        type: 'subscription',
        event: 'deleted',
        provider: subscription.provider,
        accountId: subscription.accountId,
        subscription,
      });
      return;
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(subscription.accountId);
    if (token) {
      try {
        await provider.subscriptions.delete(token, subscriptionId);
      } catch (error) {
        this.logger.warn('Failed to delete remote subscription', { subscriptionId, error });
      }
    }

    await this.storage.subscriptions.delete(subscriptionId);

    this.logger.info('Subscription deleted', { subscriptionId });
    this.hooks.emit({
      type: 'subscription',
      event: 'deleted',
      provider: account.provider,
      accountId: subscription.accountId,
      subscription,
    });
  }

  async list(accountId: string): Promise<Subscription[]> {
    return this.storage.subscriptions.list(accountId);
  }

  async get(subscriptionId: string): Promise<Subscription | null> {
    return this.storage.subscriptions.get(subscriptionId);
  }

  async handleNotification(notification: SubscriptionNotification): Promise<void> {
    const subscription = await this.storage.subscriptions.get(notification.subscriptionId);
    if (!subscription) {
      this.logger.warn('Received notification for unknown subscription', {
        subscriptionId: notification.subscriptionId,
      });
      return;
    }

    // Only enforced when the subscription actually has a secret (create() forwards it to the
    // provider as Google's channel `token` / Microsoft's `clientState`) - without this check,
    // any POST to the webhook URL with a known subscriptionId would be processed as if it came
    // from the real provider.
    if (subscription.secret && !timingSafeEqual(notification.token ?? '', subscription.secret)) {
      this.logger.warn('Rejected webhook notification that failed verification token check', {
        subscriptionId: subscription.id,
      });
      throw errors.permissionDenied(
        subscription.provider,
        'Webhook notification failed verification token check'
      );
    }

    this.logger.info('Processing webhook notification', {
      subscriptionId: subscription.id,
      changes: notification.changes?.length || 0,
    });

    await this.storage.subscriptions.update(subscription.id, {
      lastNotificationAt: notification.timestamp,
      lastNotificationStatus: 'success',
    });
    this.hooks.emit({
      type: 'subscription',
      event: 'notification',
      provider: subscription.provider,
      accountId: subscription.accountId,
      subscription,
      notification,
    });
  }

  async checkExpiry(): Promise<ExpiredSubscription[]> {
    const now = new Date();
    const expired: ExpiredSubscription[] = [];

    const accounts = await this.storage.accounts.list();

    for (const account of accounts) {
      const subscriptions = await this.storage.subscriptions.list(account.id);

      for (const sub of subscriptions) {
        if (sub.status === 'active' && sub.leaseExpiry < now) {
          expired.push({
            subscription: sub,
            expiredAt: sub.leaseExpiry,
          });

          await this.storage.subscriptions.update(sub.id, {
            status: 'expired',
            errorMessage: 'Subscription lease expired',
          });
          this.hooks.emit({
            type: 'subscription',
            event: 'expired',
            provider: sub.provider,
            accountId: sub.accountId,
            subscription: sub,
          });
        }

        const warnWindow = new Date(sub.leaseExpiry.getTime() - 24 * 60 * 60 * 1000);
        if (sub.status === 'active' && now >= warnWindow && sub.leaseExpiry > now) {
          this.logger.warn('Subscription expiring soon', {
            subscriptionId: sub.id,
            expiresAt: sub.leaseExpiry,
          });
        }
      }
    }

    return expired;
  }
}

export interface ExpiredSubscription {
  subscription: Subscription;
  expiredAt: Date;
}

// Constant-time comparison so verifying a webhook token doesn't leak timing information an
// attacker could use to guess it one character at a time.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}
