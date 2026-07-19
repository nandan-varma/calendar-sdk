/** The three built-in providers, or any custom key a third-party/testing provider registers under. */
export type ProviderKey = 'google' | 'microsoft' | 'caldav' | (string & {});

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
  const dateStr = 'date' in dt ? dt.date || '' : '';
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

// Reinterprets the same instant's wall-clock time in `toTz`, returning a proper ISO 8601 string
// (with a UTC offset) - every other `dateTime` value in this type system is ISO, and
// `date.toLocaleString(...)` here previously produced a locale-formatted, non-ISO,
// non-round-trippable string (e.g. "7/18/2026, 3:00:00 PM") instead.
function convertTimezone(dateTime: string, _fromTz: string, toTz: string): string {
  const date = new Date(dateTime);
  if (Number.isNaN(date.getTime())) return dateTime;

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: toTz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}${utcOffsetOf(date, toTz)}`;
}

// Computes toTz's UTC offset (e.g. "-07:00") for a given instant by comparing how Intl renders
// that instant in toTz against the instant's own UTC value.
function utcOffsetOf(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);

  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtcMs = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second')
  );
  const diffMinutes = Math.round((asUtcMs - date.getTime()) / 60_000);
  const sign = diffMinutes >= 0 ? '+' : '-';
  const abs = Math.abs(diffMinutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
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
