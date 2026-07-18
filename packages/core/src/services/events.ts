import type { 
  CalendarEvent, 
  CreateEventInput, 
  UpdateEventInput, 
  ListEventsQuery,
  EventOptions,
} from '../types/event.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { randomUUID } from 'node:crypto';

export class EventsService {
  private storage: StorageAdapter;
  private getToken: (accountId: string) => Promise<TokenSet | null>;
  private getProvider: (providerKey: ProviderKey) => ProviderAdapter;
  private logger: Logger;

  constructor(
    storage: StorageAdapter,
    getToken: (accountId: string) => Promise<TokenSet | null>,
    getProvider: (providerKey: ProviderKey) => ProviderAdapter,
    logger: Logger
  ) {
    this.storage = storage;
    this.getToken = getToken;
    this.getProvider = getProvider;
    this.logger = logger;
  }

  async list(calendarId: string, query?: ListEventsQuery): Promise<CalendarEvent[]> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.debug('Listing events', { calendarId, query });

    const result = await provider.events.list(token, calendar.providerId, query);

    const events: CalendarEvent[] = result.items.map(evt => ({
      ...evt,
      id: evt.id || randomUUID(),
      accountId: calendar.accountId,
      calendarId,
    }));

    await this.storage.events.saveMany(events);

    return events;
  }

  // Reads from local storage only; call events.list(calendarId) first to sync a calendar's events.
  async get(eventId: string): Promise<CalendarEvent> {
    const event = await this.storage.events.get(eventId);
    if (!event) {
      throw new CalendarSdkError({
        code: 'NOT_FOUND',
        message: 'Event not found in local storage',
        remediation: 'Call events.list(calendarId) to sync this calendar before calling get() with an event id.',
      });
    }
    return event;
  }

  async create(calendarId: string, input: CreateEventInput, options?: EventOptions): Promise<CalendarEvent> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.events;
    if (!caps.create) {
      throw errors.capabilityUnsupported('Event creation', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Creating event', { calendarId, title: input.title });

    const created = await provider.events.create(token, calendar.providerId, input, options);

    const event: CalendarEvent = {
      ...created,
      id: created.id || randomUUID(),
      accountId: calendar.accountId,
      calendarId,
      recurrenceMaster: !input.recurrence,
    };

    await this.storage.events.save(event);

    return event;
  }

  async update(eventId: string, patch: UpdateEventInput, options?: EventOptions): Promise<CalendarEvent> {
    const event = await this.storage.events.get(eventId);
    if (!event) {
      throw errors.notFound(undefined, 'Event not found');
    }

    const calendar = await this.storage.calendars.get(event.calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.events;
    if (!caps.update) {
      throw errors.capabilityUnsupported('Event update', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Updating event', { eventId, updates: Object.keys(patch) });

    const updated = await provider.events.update(token, calendar.providerId, event.providerId, patch, options);

    const result: CalendarEvent = {
      ...updated,
      id: event.id,
      accountId: calendar.accountId,
      calendarId: event.calendarId,
    };

    await this.storage.events.save(result);

    return result;
  }

  async delete(eventId: string, options?: EventOptions): Promise<void> {
    const event = await this.storage.events.get(eventId);
    if (!event) {
      return;
    }

    const calendar = await this.storage.calendars.get(event.calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.events;
    if (!caps.delete) {
      throw errors.capabilityUnsupported('Event deletion', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Deleting event', { eventId });

    await provider.events.delete(token, calendar.providerId, event.providerId, options);
    await this.storage.events.delete(eventId);
  }

  async move(eventId: string, targetCalendarId: string): Promise<CalendarEvent> {
    const event = await this.storage.events.get(eventId);
    if (!event) {
      throw errors.notFound(undefined, 'Event not found');
    }

    const sourceCalendar = await this.storage.calendars.get(event.calendarId);
    if (!sourceCalendar) {
      throw errors.notFound(undefined, 'Source calendar not found');
    }

    const targetCalendar = await this.storage.calendars.get(targetCalendarId);
    if (!targetCalendar) {
      throw errors.notFound(undefined, 'Target calendar not found');
    }

    const account = await this.storage.accounts.get(sourceCalendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    if (sourceCalendar.accountId !== targetCalendar.accountId) {
      throw new CalendarSdkError({
        code: 'VALIDATION_FAILED',
        message: 'Cannot move event between accounts',
      });
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(sourceCalendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Moving event', { eventId, from: event.calendarId, to: targetCalendarId });

    const moved = await provider.events.move(token, event.providerId, sourceCalendar.providerId, targetCalendar.providerId);

    const result: CalendarEvent = {
      ...moved,
      id: event.id,
      accountId: sourceCalendar.accountId,
      calendarId: targetCalendarId,
    };

    await this.storage.events.save(result);
    await this.storage.events.delete(eventId);

    return result;
  }

  async duplicate(eventId: string, targetCalendarId: string): Promise<CalendarEvent> {
    const event = await this.storage.events.get(eventId);
    if (!event) {
      throw errors.notFound(undefined, 'Event not found');
    }

    const sourceCalendar = await this.storage.calendars.get(event.calendarId);
    if (!sourceCalendar) {
      throw errors.notFound(undefined, 'Source calendar not found');
    }

    const targetCalendar = await this.storage.calendars.get(targetCalendarId);
    if (!targetCalendar) {
      throw errors.notFound(undefined, 'Target calendar not found');
    }

    const account = await this.storage.accounts.get(sourceCalendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(sourceCalendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Duplicating event', { eventId, to: targetCalendarId });

    const duplicated = await provider.events.duplicate(token, event.providerId, targetCalendar.providerId);

    const result: CalendarEvent = {
      ...duplicated,
      id: randomUUID(),
      accountId: sourceCalendar.accountId,
      calendarId: targetCalendarId,
      recurrenceMaster: true,
    };

    await this.storage.events.save(result);

    return result;
  }
}
