export type SyncScope = 'calendars' | 'events' | 'all';

export interface SyncCursor {
  id: string;
  provider: string;
  accountId: string;
  scope: SyncScope;
  token: string;
  expiry: Date;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface SyncCursorInput {
  provider: string;
  accountId: string;
  scope: SyncScope;
  token: string;
  expiry: Date;
  metadata?: Record<string, unknown>;
}

export interface SyncResult {
  accountId: string;
  scope: SyncScope;
  events: SyncEvent[];
  deletions: string[];
  nextCursor?: SyncCursor;
  expiredToken: boolean;
  hasMore: boolean;
}

export type SyncEvent =
  | { type: 'created'; event: import('./event.js').CalendarEvent }
  | { type: 'updated'; event: import('./event.js').CalendarEvent; previousEtag?: string }
  | { type: 'deleted'; eventId: string };

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
  scope: SyncScope;
  timeMin?: Date;
  timeMax?: Date;
}

export interface SyncCapabilityMap {
  incremental: boolean;
  webhook: boolean;
  polling: boolean;
  deltaQuery: boolean;
}
