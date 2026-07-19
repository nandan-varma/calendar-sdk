import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SubscriptionsService } from '../../../src/services/subscriptions.js';
import { createMemoryStorage, type StorageAdapter } from '../../../src/storage/index.js';
import { noopLogger } from '../../../src/logger/index.js';
import { createHooks } from '../../../src/hooks/index.js';
import type { Account } from '../../../src/types/account.js';
import type { ProviderAdapter, TokenSet } from '../../../src/adapters/provider.js';
import type { Subscription } from '../../../src/types/subscription.js';

function fakeAccount(overrides: Partial<Account> = {}): Account {
  return {
    id: 'account-1',
    provider: 'google',
    displayName: 'Test User',
    email: 'test@example.com',
    status: 'connected',
    capabilities: {
      calendars: {
        create: true,
        update: true,
        delete: true,
        share: true,
        manageNotifications: true,
      },
      events: {
        list: true,
        create: true,
        update: true,
        delete: true,
        move: true,
        duplicate: true,
        attachments: true,
        conferenceData: true,
      },
      sync: { incremental: true, webhook: true, polling: true },
      availability: { freeBusy: true, suggestedTimes: true },
    },
    raw: {},
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeSubscription(overrides: Partial<Subscription> = {}): Subscription {
  return {
    id: 'sub-1',
    accountId: 'account-1',
    provider: 'google',
    resource: 'events',
    leaseExpiry: new Date(Date.now() + 3600_000),
    renewalPolicy: 'auto',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Subscription;
}

function fakeProvider(subscriptions: Partial<ProviderAdapter['subscriptions']>): ProviderAdapter {
  return {
    subscriptions: {
      create: vi.fn(),
      renew: vi.fn(),
      delete: vi.fn(),
      list: vi.fn().mockResolvedValue([]),
      get: vi.fn(),
      ...subscriptions,
    },
  } as unknown as ProviderAdapter;
}

const TOKEN: TokenSet = { accessToken: 'real-access-token' };

describe('SubscriptionsService - hook emission', () => {
  let storage: StorageAdapter;
  let getToken: ReturnType<typeof vi.fn>;
  let getProvider: ReturnType<typeof vi.fn>;
  let hooks: ReturnType<typeof createHooks>;
  let service: SubscriptionsService;

  beforeEach(async () => {
    storage = createMemoryStorage();
    await storage.accounts.save(fakeAccount());
    getToken = vi.fn().mockResolvedValue(TOKEN);
    getProvider = vi.fn();
    hooks = createHooks();
    service = new SubscriptionsService(storage, getToken, getProvider, noopLogger, hooks);
  });

  it('emits subscription/created on create()', async () => {
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    getProvider.mockReturnValue(
      fakeProvider({
        create: vi.fn().mockResolvedValue({
          id: 'sub-1',
          resource: 'events',
          leaseExpiry: new Date(Date.now() + 3600_000),
        }),
      })
    );

    await service.create('account-1', {
      resource: 'events',
      notificationUrl: 'https://example.com/hook',
    });

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription', event: 'created', accountId: 'account-1' })
    );
  });

  it('emits subscription/renewed on renew()', async () => {
    await storage.subscriptions.save(fakeSubscription());
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    getProvider.mockReturnValue(
      fakeProvider({
        renew: vi.fn().mockResolvedValue({ leaseExpiry: new Date(Date.now() + 7200_000) }),
      })
    );

    await service.renew('sub-1');

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription', event: 'renewed', accountId: 'account-1' })
    );
  });

  it('emits subscription/deleted on delete()', async () => {
    await storage.subscriptions.save(fakeSubscription());
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    getProvider.mockReturnValue(fakeProvider({ delete: vi.fn().mockResolvedValue(undefined) }));

    await service.delete('sub-1');

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription', event: 'deleted', accountId: 'account-1' })
    );
  });

  it('emits subscription/notification on handleNotification()', async () => {
    await storage.subscriptions.save(fakeSubscription());
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    await service.handleNotification({
      subscriptionId: 'sub-1',
      timestamp: new Date(),
      resource: 'events',
    });

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription',
        event: 'notification',
        accountId: 'account-1',
      })
    );
  });

  it('accepts a notification whose token matches the subscription secret', async () => {
    await storage.subscriptions.save(fakeSubscription({ secret: 'shh-its-a-secret' }));
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    await service.handleNotification({
      subscriptionId: 'sub-1',
      timestamp: new Date(),
      resource: 'events',
      token: 'shh-its-a-secret',
    });

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'subscription',
        event: 'notification',
        accountId: 'account-1',
      })
    );
  });

  it('rejects a notification whose token does not match the subscription secret', async () => {
    await storage.subscriptions.save(fakeSubscription({ secret: 'shh-its-a-secret' }));
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    await expect(
      service.handleNotification({
        subscriptionId: 'sub-1',
        timestamp: new Date(),
        resource: 'events',
        token: 'forged',
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });

    expect(onSub).not.toHaveBeenCalled();
  });

  it('rejects a notification with a missing token when the subscription has a secret', async () => {
    await storage.subscriptions.save(fakeSubscription({ secret: 'shh-its-a-secret' }));

    await expect(
      service.handleNotification({
        subscriptionId: 'sub-1',
        timestamp: new Date(),
        resource: 'events',
      })
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
  });

  it('emits subscription/expired for leases past expiry during checkExpiry()', async () => {
    await storage.subscriptions.save(
      fakeSubscription({ leaseExpiry: new Date(Date.now() - 1000) })
    );
    const onSub = vi.fn();
    hooks.on('subscription', onSub);

    await service.checkExpiry();

    expect(onSub).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'subscription', event: 'expired', accountId: 'account-1' })
    );
  });
});
