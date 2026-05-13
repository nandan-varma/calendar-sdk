import type { 
  CalendarEvent, 
  CreateEventInput, 
  UpdateEventInput, 
  ListEventsQuery, 
  EventOptions,
  AttendeeInput,
} from '../types/event.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { v4 as uuidv4 } from 'uuid';

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
      throw errors.notFound('google', 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
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
      id: evt.id || uuidv4(),
      accountId: calendar.accountId,
      calendarId,
    }));

    await this.storage.events.saveMany(events);

    return events;
  }

  async get(eventId: string): Promise<CalendarEvent | null> {
    const event = await this.storage.events.get(eventId);
    return event;
  }

  async create(calendarId: string, input: CreateEventInput, options?: EventOptions): Promise<CalendarEvent> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw errors.notFound('google', 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
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
      id: created.id || uuidv4(),
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
      throw errors.notFound('google', 'Event not found');
    }

    const calendar = await this.storage.calendars.get(event.calendarId);
    if (!calendar) {
      throw errors.notFound('google', 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
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
      throw errors.notFound('google', 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
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
      throw errors.notFound('google', 'Event not found');
    }

    const sourceCalendar = await this.storage.calendars.get(event.calendarId);
    if (!sourceCalendar) {
      throw errors.notFound('google', 'Source calendar not found');
    }

    const targetCalendar = await this.storage.calendars.get(targetCalendarId);
    if (!targetCalendar) {
      throw errors.notFound('google', 'Target calendar not found');
    }

    const account = await this.storage.accounts.get(sourceCalendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
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
      throw errors.notFound('google', 'Event not found');
    }

    const sourceCalendar = await this.storage.calendars.get(event.calendarId);
    if (!sourceCalendar) {
      throw errors.notFound('google', 'Source calendar not found');
    }

    const targetCalendar = await this.storage.calendars.get(targetCalendarId);
    if (!targetCalendar) {
      throw errors.notFound('google', 'Target calendar not found');
    }

    const account = await this.storage.accounts.get(sourceCalendar.accountId);
    if (!account) {
      throw errors.notFound('google', 'Account not found');
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(sourceCalendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Duplicating event', { eventId, to: targetCalendarId });

    const input: CreateEventInput = {
      title: event.title,
      description: event.description,
      location: event.location,
      start: event.start,
      end: event.end,
      allDay: event.allDay,
      timezone: event.timezone,
      status: event.status,
      transparency: event.transparency,
      visibility: event.visibility,
      attendees: event.attendees.map(a => ({ email: a.email, displayName: a.displayName })),
      reminders: event.reminders,
      recurrence: event.recurrence,
    };

    const duplicated = await provider.events.duplicate(token, event.providerId, targetCalendar.providerId);

    const result: CalendarEvent = {
      ...duplicated,
      id: uuidv4(),
      accountId: sourceCalendar.accountId,
      calendarId: targetCalendarId,
      recurrenceMaster: true,
    };

    await this.storage.events.save(result);

    return result;
  }
}
