import type { CalendarEvent } from '../types/event.js';
import type { SyncCursor, SyncResult, SyncScope } from '../types/sync.js';
import type { Calendar } from '../types/calendar.js';
import type { StorageAdapter } from '../storage/index.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';

export interface SyncServiceOptions {
  storage: StorageAdapter;
  logger: Logger;
  getToken: (accountId: string) => Promise<TokenSet | null>;
  getProvider: (providerKey: ProviderKey) => ProviderAdapter;
}

export class SyncService {
  private storage: StorageAdapter;
  private logger: Logger;
  private getToken: (accountId: string) => Promise<TokenSet | null>;
  private getProvider: (providerKey: ProviderKey) => ProviderAdapter;

  constructor(options: SyncServiceOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
    this.getToken = options.getToken;
    this.getProvider = options.getProvider;
  }

  private async resolveAccountAndToken(accountId: string) {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }
    const provider = this.getProvider(account.provider);
    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }
    return { account, provider, token };
  }

  private async resolveCalendars(accountId: string, calendarId?: string): Promise<Calendar[]> {
    if (calendarId) {
      const calendar = await this.storage.calendars.get(calendarId);
      if (!calendar) {
        throw errors.notFound(undefined, 'Calendar not found');
      }
      return [calendar];
    }
    return this.storage.calendars.listByAccount(accountId);
  }

  async fullSync(accountId: string, options?: FullSyncOptions): Promise<SyncResult> {
    const { calendarId, timeMin, timeMax, limit } = options || {};
    this.logger.info('Starting full sync', { accountId, calendarId, timeMin, timeMax });

    try {
      const { account, provider, token } = await this.resolveAccountAndToken(accountId);
      const calendars = await this.resolveCalendars(accountId, calendarId);

      const results: SyncResult = {
        accountId,
        scope: 'events',
        events: [],
        deletions: [],
        expiredToken: false,
        hasMore: false,
      };

      let lastSyncResult: SyncResult | undefined;

      for (const calendar of calendars) {
        const syncResult = await provider.sync.fullSync(token, calendar.providerId, { timeMin, timeMax, limit });
        lastSyncResult = syncResult;

        for (const event of syncResult.events) {
          if (event.type === 'created' || event.type === 'updated') {
            results.events.push(event);
            await this.storage.events.save(event.event);
          } else if (event.type === 'deleted') {
            results.deletions.push(event.eventId);
            await this.storage.events.delete(event.eventId);
          }
        }
      }

      // Note: a cursor is only saved for the last calendar synced in this loop. When syncing
      // an account with multiple calendars, call fullSync/incrementalSync per-calendar via
      // options.calendarId for correct, independent cursor tracking on each one.
      if (lastSyncResult?.nextCursor) {
        const cursor: SyncCursor = {
          id: `${accountId}:events`,
          provider: account.provider,
          accountId,
          scope: 'events',
          token: lastSyncResult.nextCursor.token,
          expiry: lastSyncResult.nextCursor.expiry,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        await this.storage.syncCursors.save(cursor);
        results.nextCursor = cursor;
      }

      this.logger.info('Full sync completed', {
        accountId,
        created: results.events.filter(e => e.type === 'created').length,
        updated: results.events.filter(e => e.type === 'updated').length,
        deleted: results.deletions.length,
      });

      return results;
    } catch (error) {
      this.logger.error('Full sync failed', { accountId, error });
      throw error;
    }
  }

  async incrementalSync(
    accountId: string,
    cursor: SyncCursor,
    options?: IncrementalSyncOptions
  ): Promise<SyncResult> {
    this.logger.info('Starting incremental sync', {
      accountId,
      scope: cursor.scope,
      cursorToken: `${cursor.token.substring(0, 20)}...`,
    });

    try {
      const { provider, token } = await this.resolveAccountAndToken(accountId);
      const [calendar] = await this.resolveCalendars(accountId, options?.calendarId);
      if (!calendar) {
        throw new CalendarSdkError({
          code: 'VALIDATION_FAILED',
          message: 'No calendar to sync',
          remediation: 'Pass options.calendarId, or sync an account that has at least one calendar from calendars.list().',
        });
      }

      const result = await provider.sync.incrementalSync(token, calendar.providerId, cursor);

      if (result.expiredToken) {
        this.logger.warn('Sync token expired, full resync required', { accountId });
        await this.storage.syncCursors.delete(accountId, cursor.scope);
        return { ...result, expiredToken: true };
      }

      for (const event of result.events) {
        if (event.type === 'created' || event.type === 'updated') {
          await this.storage.events.save(event.event);
        } else if (event.type === 'deleted') {
          await this.storage.events.delete(event.eventId);
        }
      }

      for (const eventId of result.deletions) {
        await this.storage.events.delete(eventId);
      }

      if (result.nextCursor) {
        await this.storage.syncCursors.save({
          ...cursor,
          token: result.nextCursor.token,
          expiry: result.nextCursor.expiry,
          updatedAt: new Date(),
        });
      }

      this.logger.info('Incremental sync completed', {
        accountId,
        changes: result.events.length + result.deletions.length,
        hasMore: result.hasMore,
      });

      return result;
    } catch (error) {
      if (error instanceof CalendarSdkError && error.code === 'SYNC_CURSOR_EXPIRED') {
        this.logger.warn('Sync cursor expired during incremental sync', { accountId });
        await this.storage.syncCursors.delete(accountId, cursor.scope);

        return {
          accountId,
          scope: cursor.scope,
          events: [],
          deletions: [],
          expiredToken: true,
          hasMore: false,
        };
      }
      throw error;
    }
  }

  async reconcile(accountId: string, scope: SyncScope, options?: ReconcileOptions): Promise<ReconcileResult> {
    this.logger.info('Starting reconciliation', { accountId, scope });

    const { provider, token } = await this.resolveAccountAndToken(accountId);
    const calendars = await this.resolveCalendars(accountId, options?.calendarId);

    const localEvents = await this.storage.events.listByAccount(accountId, {
      timeMin: options?.timeMin,
      timeMax: options?.timeMax,
    });

    const localIds = new Set(localEvents.map(e => e.id));

    const remoteIds = new Set<string>();
    const toCreate: CalendarEvent[] = [];
    const toUpdate: CalendarEvent[] = [];
    const toDelete: string[] = [];

    for (const calendar of calendars) {
      const remoteResult = await provider.sync.fullSync(token, calendar.providerId, {
        timeMin: options?.timeMin,
        timeMax: options?.timeMax,
      });

      for (const event of remoteResult.events) {
        if (event.type === 'created' || event.type === 'updated') {
          remoteIds.add(event.event.providerId);
          if (event.type === 'created') {
            toCreate.push(event.event);
          } else {
            toUpdate.push(event.event);
          }
        } else if (event.type === 'deleted') {
          remoteIds.add(event.eventId);
          if (localIds.has(event.eventId)) {
            toDelete.push(event.eventId);
          }
        }
      }
    }

    const missingLocally = [...localIds].filter(id => !remoteIds.has(id));
    for (const id of missingLocally) {
      const local = await this.storage.events.get(id);
      if (local && !local.deletedAt) {
        toDelete.push(id);
      }
    }

    await this.storage.events.saveMany([...toCreate, ...toUpdate]);
    for (const id of toDelete) {
      await this.storage.events.delete(id);
    }

    this.logger.info('Reconciliation completed', {
      accountId,
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
    });

    return {
      created: toCreate.length,
      updated: toUpdate.length,
      deleted: toDelete.length,
      conflicts: [],
    };
  }

  async getSyncStatus(accountId: string): Promise<SyncStatus> {
    const cursors = await this.storage.syncCursors.list(accountId);

    return {
      accountId,
      cursors: cursors.map(c => ({
        scope: c.scope,
        hasCursor: !!c.token,
        expired: c.expiry < new Date(),
        expiresAt: c.expiry,
      })),
      lastSync: cursors.length > 0
        ? new Date(Math.max(...cursors.map(c => c.updatedAt.getTime())))
        : undefined,
    };
  }
}

export interface FullSyncOptions {
  calendarId?: string;
  timeMin?: Date;
  timeMax?: Date;
  limit?: number;
}

export interface IncrementalSyncOptions {
  calendarId?: string;
}

export interface ReconcileOptions {
  calendarId?: string;
  timeMin?: Date;
  timeMax?: Date;
}

export interface ReconcileResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: ReconcileConflict[];
}

export interface ReconcileConflict {
  localEvent: CalendarEvent;
  remoteEvent: CalendarEvent;
  conflictType: 'both_modified' | 'deleted_remotely' | 'deleted_locally';
}

export interface SyncStatus {
  accountId: string;
  cursors: {
    scope: string;
    hasCursor: boolean;
    expired: boolean;
    expiresAt: Date;
  }[];
  lastSync?: Date;
}
