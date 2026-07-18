import type { Calendar, CreateCalendarInput, UpdateCalendarInput, ListCalendarsQuery, ShareCalendarInput } from '../types/calendar.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { randomUUID } from 'node:crypto';

export class CalendarsService {
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

  async list(accountId: string, query?: ListCalendarsQuery): Promise<Calendar[]> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.debug('Listing calendars', { accountId });

    const provider = this.getProvider(account.provider);
    const result = await provider.calendars.list(token, query);

    for (const cal of result.items) {
      const calendar: Calendar = {
        ...cal,
        accountId,
        capabilities: this.getCalendarCapabilities(cal.accessRole),
      };
      await this.storage.calendars.save(calendar);
    }

    return result.items;
  }

  // Reads from local storage only; call calendars.list(accountId) first to sync an account's calendars.
  async get(calendarId: string): Promise<Calendar> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw new CalendarSdkError({
        code: 'NOT_FOUND',
        message: 'Calendar not found in local storage',
        remediation: 'Call calendars.list(accountId) to sync this account before calling get() with a calendar id.',
      });
    }
    return calendar;
  }

  async create(accountId: string, input: CreateCalendarInput): Promise<Calendar> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const provider = this.getProvider(account.provider);
    const caps = provider.getCapabilities();
    if (!caps.calendars.create) {
      throw errors.capabilityUnsupported('Calendar creation', account.provider);
    }

    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Creating calendar', { accountId, name: input.name });

    const created = await provider.calendars.create(token, input);

    const calendar: Calendar = {
      ...created,
      id: randomUUID(),
      accountId,
      capabilities: this.getCalendarCapabilities(created.accessRole),
    };

    await this.storage.calendars.save(calendar);

    return calendar;
  }

  async update(calendarId: string, patch: UpdateCalendarInput): Promise<Calendar> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.calendars;
    if (!caps.update) {
      throw errors.capabilityUnsupported('Calendar update', account.provider);
    }

    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Updating calendar', { calendarId, updates: Object.keys(patch) });

    const provider = this.getProvider(account.provider);
    const updated = await provider.calendars.update(token, calendar.providerId, patch);

    const result: Calendar = {
      ...updated,
      id: calendar.id,
      accountId: calendar.accountId,
      capabilities: this.getCalendarCapabilities(updated.accessRole),
    };

    await this.storage.calendars.save(result);

    return result;
  }

  async delete(calendarId: string): Promise<void> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      return;
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.calendars;
    if (!caps.delete) {
      throw errors.capabilityUnsupported('Calendar deletion', account.provider);
    }

    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Deleting calendar', { calendarId });

    const provider = this.getProvider(account.provider);
    await provider.calendars.delete(token, calendar.providerId);
    await this.storage.events.deleteByCalendar(calendarId);
    await this.storage.calendars.delete(calendarId);
  }

  async share(calendarId: string, input: ShareCalendarInput): Promise<void> {
    const calendar = await this.storage.calendars.get(calendarId);
    if (!calendar) {
      throw errors.notFound(undefined, 'Calendar not found');
    }

    const account = await this.storage.accounts.get(calendar.accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.calendars;
    if (!caps.share) {
      throw errors.capabilityUnsupported('Calendar sharing', account.provider);
    }

    const provider = this.getProvider(account.provider);
    if (!provider.calendars.share) {
      throw errors.capabilityUnsupported('Calendar sharing', account.provider);
    }

    const token = await this.getToken(calendar.accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.info('Sharing calendar', { calendarId, email: input.email, role: input.role });

    await provider.calendars.share(token, calendar.providerId, input);
  }

  private getCalendarCapabilities(accessRole: string): Calendar['capabilities'] {
    return {
      create: accessRole === 'owner' || accessRole === 'writer',
      update: accessRole === 'owner' || accessRole === 'writer',
      delete: accessRole === 'owner',
      share: accessRole === 'owner',
      manageNotifications: accessRole === 'owner' || accessRole === 'writer',
    };
  }
}
