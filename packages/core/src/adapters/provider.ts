import type { ProviderKey } from '../types/common.js';
import type { Account } from '../types/account.js';
import type { Calendar, CreateCalendarInput, UpdateCalendarInput, ListCalendarsQuery, ShareCalendarInput } from '../types/calendar.js';
import type { 
  CalendarEvent, 
  CreateEventInput, 
  UpdateEventInput, 
  ListEventsQuery, 
  EventOptions,
  ExpandedOccurrence,
} from '../types/event.js';
import type { FreeBusyQuery, FreeBusyResult, SuggestMeetingQuery, SuggestMeetingResult } from '../types/availability.js';
import type { SyncCursor, SyncResult } from '../types/sync.js';
import type { Subscription, SubscriptionInput, SubscriptionConfig } from '../types/subscription.js';
import type { CapabilityMap } from '../capabilities/index.js';
import type { Paginated } from '../types/common.js';
import type { Transport } from '../transport/index.js';

export interface ProviderAdapter {
  readonly key: ProviderKey;
  readonly displayName: string;
  
  auth: AuthProviderMethods;
  accounts: AccountsProviderMethods;
  calendars: CalendarsProviderMethods;
  events: EventsProviderMethods;
  availability: AvailabilityProviderMethods;
  sync: SyncProviderMethods;
  subscriptions: SubscriptionsProviderMethods;
  
  getCapabilities(): CapabilityMap;
  createTransport(): Transport;
}

export interface AuthProviderMethods {
  createAuthorizationUrl(options: CreateAuthUrlOptions): Promise<string>;
  exchangeCode(code: string, redirectUri: string): Promise<TokenSet>;
  refreshToken(token: RefreshToken): Promise<TokenSet>;
  revokeToken(token: string): Promise<void>;
}

export interface CreateAuthUrlOptions {
  clientId: string;
  redirectUri: string;
  scope: string[];
  state?: string;
  accessType?: 'online' | 'offline';
  prompt?: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: Date;
  tokenType?: string;
  scope?: string[];
}

export interface RefreshToken {
  refreshToken: string;
  clientId?: string;
  clientSecret?: string;
}

export interface AccountsProviderMethods {
  getAccount(token: TokenSet): Promise<Account>;
}

export interface CalendarsProviderMethods {
  list(token: TokenSet, query?: ListCalendarsQuery): Promise<Paginated<Calendar>>;
  get(token: TokenSet, id: string): Promise<Calendar>;
  create(token: TokenSet, input: CreateCalendarInput): Promise<Calendar>;
  update(token: TokenSet, id: string, patch: UpdateCalendarInput): Promise<Calendar>;
  delete(token: TokenSet, id: string): Promise<void>;
  /** Omit entirely for providers that can't share calendars (capability map should report `share: false`). */
  share?(token: TokenSet, id: string, input: ShareCalendarInput): Promise<void>;
}

export interface EventsProviderMethods {
  list(token: TokenSet, calendarId: string, query?: ListEventsQuery): Promise<Paginated<CalendarEvent>>;
  get(token: TokenSet, calendarId: string, id: string): Promise<CalendarEvent>;
  create(token: TokenSet, calendarId: string, input: CreateEventInput, opts?: EventOptions): Promise<CalendarEvent>;
  update(token: TokenSet, calendarId: string, id: string, patch: UpdateEventInput, opts?: EventOptions): Promise<CalendarEvent>;
  delete(token: TokenSet, calendarId: string, id: string, opts?: EventOptions): Promise<void>;
  move(token: TokenSet, eventId: string, sourceCalendarId: string, targetCalendarId: string): Promise<CalendarEvent>;
  duplicate(token: TokenSet, eventId: string, targetCalendarId: string): Promise<CalendarEvent>;
  expandRecurrence(token: TokenSet, calendarId: string, eventId: string, timeMin: Date, timeMax: Date): Promise<ExpandedOccurrence[]>;
}

export interface AvailabilityProviderMethods {
  freeBusy(token: TokenSet, query: FreeBusyQuery): Promise<FreeBusyResult>;
  suggestMeeting(token: TokenSet, query: SuggestMeetingQuery): Promise<SuggestMeetingResult>;
}

export interface SyncProviderMethods {
  fullSync(token: TokenSet, calendarId: string, options?: FullSyncProviderOptions): Promise<SyncResult>;
  incrementalSync(token: TokenSet, calendarId: string, cursor: SyncCursor): Promise<SyncResult>;
}

export interface FullSyncProviderOptions {
  timeMin?: Date;
  timeMax?: Date;
  limit?: number;
}

export interface SubscriptionsProviderMethods {
  create(token: TokenSet, config: SubscriptionConfig): Promise<Subscription>;
  renew(token: TokenSet, subscriptionId: string): Promise<Subscription>;
  delete(token: TokenSet, subscriptionId: string): Promise<void>;
  list(token: TokenSet, accountId: string): Promise<Subscription[]>;
  get(token: TokenSet, subscriptionId: string): Promise<Subscription>;
  validateWebhook?(webhookUrl: string, validationToken?: string): Promise<boolean>;
}

