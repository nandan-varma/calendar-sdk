export type ProviderKey = 'google' | 'microsoft' | 'caldav';

export interface DateTime {
  dateTime: string;
  timezone: string;
  date?: never;
}

export interface DateOnly {
  date: string;
  timezone?: never;
  dateTime?: never;
}

export type DateTimeValue = DateTime | DateOnly;

export function isAllDay(dt: DateTimeValue): dt is DateOnly {
  return 'date' in dt && dt.date !== undefined;
}

export function toDate(dt: DateTimeValue): Date {
  if ('dateTime' in dt && dt.dateTime) {
    return new Date(dt.dateTime);
  }
  const dateStr = 'date' in dt ? (dt.date || '') : '';
  return new Date(`${dateStr}T00:00:00`);
}

export function toDateTimeString(dt: DateTimeValue, timezone?: string): string {
  if ('date' in dt) {
    return dt.date || '';
  }
  const dateTime = dt.dateTime || '';
  if (timezone && dt.timezone !== timezone) {
    return convertTimezone(dateTime, dt.timezone || 'UTC', timezone);
  }
  return dateTime;
}

function convertTimezone(dateTime: string, fromTz: string, toTz: string): string {
  const date = new Date(dateTime);
  return date.toLocaleString('en-US', { timeZone: toTz });
}

export interface PaginationToken {
  pageToken?: string;
  nextPageToken?: string;
}

export interface Paginated<T> {
  items: T[];
  nextPageToken?: string;
  totalItems?: number;
}

export interface RequestOptions {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
}

export type RawProviderData = unknown;

export interface Extensions {
  [key: string]: unknown;
}
