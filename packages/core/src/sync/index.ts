import type { CalendarEvent } from '../types/event.js';
import type { SyncCursor, SyncResult, SyncScope } from '../types/sync.js';
import type { Calendar } from '../types/calendar.js';
import type { StorageAdapter } from '../storage/index.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { Logger } from '../logger/index.js';
import type { Hooks } from '../hooks/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';

export interface SyncServiceOptions {
  storage: StorageAdapter;
  logger: Logger;
  getToken: (accountId: string) => Promise<TokenSet | null>;
  getProvider: (providerKey: ProviderKey) => ProviderAdapter;
  hooks: Hooks;
}

export class SyncService {
  private storage: StorageAdapter;
  private logger: Logger;
  private getToken: (accountId: string) => Promise<TokenSet | null>;
  private getProvider: (providerKey: ProviderKey) => ProviderAdapter;
  private hooks: Hooks;

  constructor(options: SyncServiceOptions) {
    this.storage = options.storage;
    this.logger = options.logger;
    this.getToken = options.getToken;
    this.getProvider = options.getProvider;
    this.hooks = options.hooks;
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

  // Sync results only carry the provider's own event id (see SyncEvent's 'deleted' variant),
  // but storage is keyed by the SDK-local id - this is the only correct way to translate one
  // to the other. Returns null (and does nothing) if the event was never synced locally.
  private async resolveLocalDeletionId(
    calendar: Calendar,
    providerEventId: string
  ): Promise<string | null> {
    const existing = await this.storage.events.getByProviderId(calendar.id, providerEventId);
    return existing?.id ?? null;
  }

  async fullSync(accountId: string, options?: FullSyncOptions): Promise<SyncResult> {
    const { calendarId, timeMin, timeMax, limit } = options || {};
    const startedAt = Date.now();
    let resolvedProvider: ProviderKey | undefined;
    this.logger.info('Starting full sync', { accountId, calendarId, timeMin, timeMax });

    try {
      const { account, provider, token } = await this.resolveAccountAndToken(accountId);
      resolvedProvider = account.provider;
      this.hooks.emit({
        type: 'sync',
        event: 'start',
        provider: account.provider,
        accountId,
        scope: 'events',
      });
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
        const syncResult = await provider.sync.fullSync(token, calendar.providerId, {
          timeMin,
          timeMax,
          limit,
        });
        lastSyncResult = syncResult;

        for (const event of syncResult.events) {
          if (event.type === 'created' || event.type === 'updated') {
            results.events.push(event);
            await this.storage.events.save(event.event);
          } else if (event.type === 'deleted') {
            const localId = await this.resolveLocalDeletionId(calendar, event.eventId);
            if (localId) {
              results.deletions.push(localId);
              await this.storage.events.delete(localId);
            }
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

      const created = results.events.filter((e) => e.type === 'created').length;
      const updated = results.events.filter((e) => e.type === 'updated').length;
      this.logger.info('Full sync completed', {
        accountId,
        created,
        updated,
        deleted: results.deletions.length,
      });
      this.hooks.emit({
        type: 'sync',
        event: 'end',
        provider: account.provider,
        accountId,
        scope: 'events',
        created,
        updated,
        deleted: results.deletions.length,
        duration: Date.now() - startedAt,
      });

      return results;
    } catch (error) {
      this.logger.error('Full sync failed', { accountId, error });
      if (resolvedProvider) {
        this.hooks.emit({
          type: 'sync',
          event: 'end',
          provider: resolvedProvider,
          accountId,
          scope: 'events',
          duration: Date.now() - startedAt,
          error: error instanceof CalendarSdkError ? error : undefined,
        });
      }
      throw error;
    }
  }

  async incrementalSync(
    accountId: string,
    cursor: SyncCursor,
    options?: IncrementalSyncOptions
  ): Promise<SyncResult> {
    const startedAt = Date.now();
    let resolvedProvider: ProviderKey | undefined;
    this.logger.info('Starting incremental sync', {
      accountId,
      scope: cursor.scope,
      cursorToken: `${cursor.token.substring(0, 20)}...`,
    });

    try {
      const { account, provider, token } = await this.resolveAccountAndToken(accountId);
      resolvedProvider = account.provider;
      this.hooks.emit({
        type: 'sync',
        event: 'start',
        provider: account.provider,
        accountId,
        scope: cursor.scope,
      });
      const [calendar] = await this.resolveCalendars(accountId, options?.calendarId);
      if (!calendar) {
        throw new CalendarSdkError({
          code: 'VALIDATION_FAILED',
          message: 'No calendar to sync',
          remediation:
            'Pass options.calendarId, or sync an account that has at least one calendar from calendars.list().',
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
          const localId = await this.resolveLocalDeletionId(calendar, event.eventId);
          if (localId) {
            await this.storage.events.delete(localId);
          }
        }
      }

      for (const providerEventId of result.deletions) {
        const localId = await this.resolveLocalDeletionId(calendar, providerEventId);
        if (localId) {
          await this.storage.events.delete(localId);
        }
      }

      if (result.nextCursor) {
        await this.storage.syncCursors.save({
          ...cursor,
          token: result.nextCursor.token,
          expiry: result.nextCursor.expiry,
          updatedAt: new Date(),
        });
      }

      const created = result.events.filter((e) => e.type === 'created').length;
      const updated = result.events.filter((e) => e.type === 'updated').length;
      const deleted =
        result.events.filter((e) => e.type === 'deleted').length + result.deletions.length;
      this.logger.info('Incremental sync completed', {
        accountId,
        changes: result.events.length + result.deletions.length,
        hasMore: result.hasMore,
      });
      this.hooks.emit({
        type: 'sync',
        event: 'end',
        provider: account.provider,
        accountId,
        scope: cursor.scope,
        created,
        updated,
        deleted,
        duration: Date.now() - startedAt,
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
      if (resolvedProvider) {
        this.hooks.emit({
          type: 'sync',
          event: 'end',
          provider: resolvedProvider,
          accountId,
          scope: cursor.scope,
          duration: Date.now() - startedAt,
          error: error instanceof CalendarSdkError ? error : undefined,
        });
      }
      throw error;
    }
  }

  async reconcile(
    accountId: string,
    scope: SyncScope,
    options?: ReconcileOptions
  ): Promise<ReconcileResult> {
    this.logger.info('Starting reconciliation', { accountId, scope });

    const { provider, token } = await this.resolveAccountAndToken(accountId);
    const calendars = await this.resolveCalendars(accountId, options?.calendarId);

    const toCreate: CalendarEvent[] = [];
    const toUpdate: CalendarEvent[] = [];
    const toDelete: string[] = [];

    // Reconciliation compares by providerId, not the SDK-local id: the two are only guaranteed
    // to be equal by coincidence (see EventsService.move()), so comparing local ids against
    // provider ids would misclassify every live, still-existing event as "missing locally" and
    // delete it. providerId is only unique within a calendar, so the comparison is scoped per
    // calendar too.
    for (const calendar of calendars) {
      const localEvents = await this.storage.events.list(calendar.id, {
        timeMin: options?.timeMin,
        timeMax: options?.timeMax,
      });
      const localByProviderId = new Map(localEvents.map((e) => [e.providerId, e] as const));

      const remoteResult = await provider.sync.fullSync(token, calendar.providerId, {
        timeMin: options?.timeMin,
        timeMax: options?.timeMax,
      });

      const remoteProviderIds = new Set<string>();

      for (const event of remoteResult.events) {
        if (event.type === 'created' || event.type === 'updated') {
          remoteProviderIds.add(event.event.providerId);
          if (localByProviderId.has(event.event.providerId)) {
            toUpdate.push(event.event);
          } else {
            toCreate.push(event.event);
          }
        } else if (event.type === 'deleted') {
          remoteProviderIds.add(event.eventId);
          const existing = localByProviderId.get(event.eventId);
          if (existing) {
            toDelete.push(existing.id);
          }
        }
      }

      for (const [providerId, local] of localByProviderId) {
        if (!remoteProviderIds.has(providerId) && !local.deletedAt) {
          toDelete.push(local.id);
        }
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
      cursors: cursors.map((c) => ({
        scope: c.scope,
        hasCursor: !!c.token,
        expired: c.expiry < new Date(),
        expiresAt: c.expiry,
      })),
      lastSync:
        cursors.length > 0
          ? new Date(Math.max(...cursors.map((c) => c.updatedAt.getTime())))
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
