import type { ProviderKey } from './types/common.js';
import type { ProviderAdapter } from './adapters/provider.js';
import type { StorageAdapter } from './storage/index.js';
import type { Logger, LoggerOptions } from './logger/index.js';
import type { Hooks } from './hooks/index.js';
import type { RetryOptions } from './transport/index.js';

import { createLogger, noopLogger } from './logger/index.js';
import { createHooks } from './hooks/index.js';
import { createMemoryStorage, type StorageAdapter as IStorageAdapter } from './storage/index.js';
import { defaultRetryOptions } from './transport/index.js';

import { AccountsService } from './services/accounts.js';
import { CalendarsService } from './services/calendars.js';
import { EventsService } from './services/events.js';
import { AvailabilityService } from './services/availability.js';
import { SubscriptionsService } from './services/subscriptions.js';
import { SyncService } from './sync/index.js';

export interface SdkConfig {
  providers: ProviderInstance[];
  storage?: StorageAdapter;
  logger?: Logger;
  loggerOptions?: LoggerOptions;
  fetch?: typeof fetch;
  retryOptions?: RetryOptions;
  hooks?: Hooks;
}

export interface ProviderInstance {
  key: ProviderKey;
  adapter: ProviderAdapter;
}

export interface CalendarSdk {
  accounts: AccountsService;
  calendars: CalendarsService;
  events: EventsService;
  availability: AvailabilityService;
  subscriptions: SubscriptionsService;
  sync: SyncService;
  hooks: Hooks;
  storage: StorageAdapter;
  getProvider(key: ProviderKey): ProviderAdapter;
}

export function createCalendarSdk(config: SdkConfig): CalendarSdk {
  const {
    providers,
    storage = createMemoryStorage(),
    logger,
    loggerOptions,
    hooks,
  } = config;

  const effectiveLogger = logger ?? createLogger({ ...loggerOptions, prettyPrint: true });
  const effectiveHooks = hooks ?? createHooks();

  const providerMap = new Map<ProviderKey, ProviderAdapter>();
  const tokenCache = new Map<string, { token: string; expiresAt?: Date }>();

  for (const provider of providers) {
    providerMap.set(provider.key, provider.adapter);
  }

  async function getToken(accountId: string): Promise<string | null> {
    const cached = tokenCache.get(accountId);
    if (cached && cached.expiresAt && cached.expiresAt.getTime() > Date.now()) {
      return cached.token;
    }

    const tokens = await storage.tokens.get(accountId);
    if (!tokens) {
      return null;
    }

    if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now()) {
      const account = await storage.accounts.get(accountId);
      if (account && account.status === 'connected') {
        try {
          const provider = providerMap.get(account.provider);
          if (provider) {
            const newTokens = await provider.auth.refreshToken({ refreshToken: tokens.refreshToken! });
            await storage.tokens.save(accountId, {
              accessToken: newTokens.accessToken,
              refreshToken: newTokens.refreshToken || tokens.refreshToken,
              expiresAt: newTokens.expiresAt,
            });
            tokenCache.set(accountId, { 
              token: newTokens.accessToken, 
              expiresAt: newTokens.expiresAt 
            });
            return newTokens.accessToken;
          }
        } catch (error) {
          effectiveLogger.warn('Token refresh failed', { accountId, error });
          await storage.accounts.update(accountId, { status: 'expired' });
          return null;
        }
      }
      return null;
    }

    tokenCache.set(accountId, { token: tokens.accessToken, expiresAt: tokens.expiresAt });
    return tokens.accessToken;
  }

  function getProvider(accountId: string | ProviderKey): ProviderAdapter {
    const key = typeof accountId === 'string' 
      ? (async () => {
          const account = await storage.accounts.get(accountId);
          return account?.provider;
        })() as any
      : accountId;

    if (typeof key !== 'string') {
      throw new Error('Cannot determine provider');
    }

    const provider = providerMap.get(key as ProviderKey);
    if (!provider) {
      throw new Error(`Provider not configured: ${key}`);
    }
    return provider;
  }

  const getProviderSync = (_accountId: string): ProviderAdapter | null => {
    return null;
  };

  const accountsService = new AccountsService(storage, providerMap, effectiveLogger);
  const calendarsService = new CalendarsService(storage, async (accountId) => {
    const account = await storage.accounts.get(accountId);
    if (!account) throw new Error('Account not found');
    const provider = providerMap.get(account.provider);
    if (!provider) throw new Error('Provider not configured');
    return { provider, accountId };
  }, effectiveLogger);
  const eventsService = new EventsService(storage, getToken, getProvider as any, effectiveLogger);
  const availabilityService = new AvailabilityService(storage, getToken, getProvider as any, effectiveLogger);
  const subscriptionsService = new SubscriptionsService(storage, getToken, getProvider as any, effectiveLogger);
  const syncService = new SyncService({ storage, logger: effectiveLogger });

  for (const provider of providers) {
    (calendarsService as any).setProvider(provider.adapter);
  }

  effectiveLogger.info('Calendar SDK initialized', {
    providers: providers.map(p => p.key),
    storageType: storage === createMemoryStorage() ? 'memory' : 'custom',
  });

  return {
    accounts: accountsService,
    calendars: calendarsService,
    events: eventsService,
    availability: availabilityService,
    subscriptions: subscriptionsService,
    sync: syncService,
    hooks: effectiveHooks,
    storage,
    getProvider: (key: ProviderKey) => providerMap.get(key)!,
  };
}

export { createMemoryStorage } from './storage/index.js';
export { createLogger, noopLogger } from './logger/index.js';
export { createHooks, EventEmitter } from './hooks/index.js';
export { defaultRetryOptions } from './transport/index.js';

export { 
  Account, AccountStatus, AccountInput, AuthInput, ConnectOptions,
  Calendar, CalendarAccessRole, CreateCalendarInput, UpdateCalendarInput, ListCalendarsQuery, ShareCalendarInput,
  CalendarEvent, Attendee, Organizer, Reminder, Recurrence, EventException, ConferenceData, ConferenceEntryPoint, Attachment, CreateEventInput, AttendeeInput, CreateConferenceInput, CreateAttachmentInput, UpdateEventInput, ListEventsQuery, EventOptions, ExpandedOccurrence,
  FreeBusyQuery, FreeBusyResult, FreeBusyStatus, FreeBusyBlock, MeetingTimeSuggestion, SuggestMeetingQuery, SuggestMeetingResult,
  SyncCursor, SyncCursorInput, SyncResult, SyncEvent, FullSyncOptions, IncrementalSyncOptions, ReconcileOptions,
  Subscription, SubscriptionStatus, SubscriptionRenewalPolicy, SubscriptionInput, SubscriptionConfig, SubscriptionRetryPolicy, CreateSubscriptionOptions, SubscriptionNotification, SubscriptionChange,
  ProviderKey, DateTime, DateOnly, DateTimeValue, PaginationToken, Paginated, RequestOptions, RawProviderData, Extensions, isAllDay, toDate, toDateTimeString,
} from './types/index.js';

export { CalendarSdkError, ErrorCode, isCalendarSdkError, mapHttpError, errors } from './errors/index.js';

export { 
  CapabilityMap, CalendarCapabilityMap, EventCapabilityMap, SyncCapabilityMap, AvailabilityCapabilityMap,
  defaultCapabilityMap, mergeCapabilities, getCapabilitiesForProvider,
} from './capabilities/index.js';

export { 
  ProviderAdapter, AuthProviderMethods, TokenSet, RefreshToken, AccountsProviderMethods, 
  CalendarsProviderMethods, EventsProviderMethods, AvailabilityProviderMethods, SyncProviderMethods, 
  SubscriptionsProviderMethods, ProviderConfig, createProviderAdapter,
} from './adapters/provider.js';