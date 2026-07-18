import type { ProviderKey } from './types/common.js';
import type { ProviderAdapter } from './adapters/provider.js';
import type { StorageAdapter } from './storage/index.js';
import type { Logger, LoggerOptions } from './logger/index.js';
import type { Hooks } from './hooks/index.js';

import { createLogger } from './logger/index.js';
import { createHooks } from './hooks/index.js';
import { createMemoryStorage } from './storage/index.js';
import { createTokenManager } from './token-manager.js';
import { CalendarSdkError } from './errors/index.js';

import { AccountsService } from './services/accounts.js';
import { CalendarsService } from './services/calendars.js';
import { EventsService } from './services/events.js';
import { AvailabilityService } from './services/availability.js';
import { SubscriptionsService } from './services/subscriptions.js';
import { SyncService } from './sync/index.js';

export interface SdkConfig {
  /** One adapter per provider you want to support - createGoogleProvider(...), createMicrosoftProvider(...), createCalDavProvider(...), etc. */
  providers: ProviderAdapter[];
  storage?: StorageAdapter;
  logger?: Logger;
  loggerOptions?: LoggerOptions;
  hooks?: Hooks;
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
  const usingDefaultStorage = config.storage === undefined;
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
  for (const provider of providers) {
    providerMap.set(provider.key, provider);
  }

  function getProvider(providerKey: ProviderKey): ProviderAdapter {
    const provider = providerMap.get(providerKey);
    if (!provider) {
      throw new CalendarSdkError({
        code: 'VALIDATION_FAILED',
        message: `Provider not configured: ${providerKey}`,
        remediation: `Pass a ${providerKey} adapter (e.g. createGoogleProvider(...)) in createCalendarSdk({ providers: [...] }).`,
      });
    }
    return provider;
  }

  const tokenManager = createTokenManager(storage, providerMap, effectiveLogger);
  const getToken = (accountId: string) => tokenManager.getToken(accountId);

  const accountsService = new AccountsService(storage, providerMap, effectiveLogger, tokenManager, effectiveHooks);
  const calendarsService = new CalendarsService(storage, getToken, getProvider, effectiveLogger);
  const eventsService = new EventsService(storage, getToken, getProvider, effectiveLogger);
  const availabilityService = new AvailabilityService(storage, getToken, getProvider, effectiveLogger);
  const subscriptionsService = new SubscriptionsService(storage, getToken, getProvider, effectiveLogger, effectiveHooks);
  const syncService = new SyncService({ storage, logger: effectiveLogger, getToken, getProvider, hooks: effectiveHooks });

  effectiveLogger.info('Calendar SDK initialized', {
    providers: providers.map((p) => p.key),
    storageType: usingDefaultStorage ? 'memory' : 'custom',
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
    getProvider,
  };
}

export { createMemoryStorage } from './storage/index.js';
export { createLogger, noopLogger } from './logger/index.js';
export type { Logger } from './logger/index.js';
export { createHooks, EventEmitter } from './hooks/index.js';
export { createTransport, defaultRetryOptions } from './transport/index.js';
export type {
  Transport,
  TransportConfig,
  TransportResponse,
  RetryOptions,
  RequestOptions as TransportRequestOptions,
} from './transport/index.js';

export { 
  Account, AccountStatus, AccountInput, AuthInput, ConnectOptions,
  Calendar, CalendarAccessRole, CreateCalendarInput, UpdateCalendarInput, ListCalendarsQuery, ShareCalendarInput,
  CalendarEvent, Attendee, Organizer, Reminder, Recurrence, EventException, ConferenceData, ConferenceEntryPoint, Attachment, CreateEventInput, AttendeeInput, CreateConferenceInput, CreateAttachmentInput, UpdateEventInput, ListEventsQuery, EventOptions, ExpandedOccurrence, EventStatus, EventTransparency, EventVisibility,
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
  ProviderAdapter, AuthProviderMethods, CreateAuthUrlOptions, TokenSet, RefreshToken, AccountsProviderMethods,
  CalendarsProviderMethods, EventsProviderMethods, AvailabilityProviderMethods, SyncProviderMethods,
  SubscriptionsProviderMethods,
} from './adapters/provider.js';
