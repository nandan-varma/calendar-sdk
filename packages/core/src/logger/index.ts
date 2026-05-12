export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: Date;
  provider?: string;
  accountId?: string;
  calendarId?: string;
  operation?: string;
  requestId?: string;
  duration?: number;
  retryCount?: number;
  metadata?: Record<string, unknown>;
}

export interface Logger {
  debug(message: string, meta?: LoggerMeta): void;
  info(message: string, meta?: LoggerMeta): void;
  warn(message: string, meta?: LoggerMeta): void;
  error(message: string, meta?: LoggerMeta): void;
}

export interface LoggerMeta {
  provider?: string;
  accountId?: string;
  calendarId?: string;
  operation?: string;
  requestId?: string;
  duration?: number;
  retryCount?: number;
  status?: number;
  error?: Error | unknown;
  [key: string]: unknown;
}

export interface LoggerOptions {
  minLevel?: LogLevel;
  includeTimestamp?: boolean;
  includeContext?: boolean;
  redactSensitive?: boolean;
  prettyPrint?: boolean;
}

export const defaultLoggerOptions: LoggerOptions = {
  minLevel: 'info',
  includeTimestamp: true,
  includeContext: true,
  redactSensitive: true,
  prettyPrint: false,
};

export function createLogger(options: LoggerOptions = {}): Logger {
  const opts = { ...defaultLoggerOptions, ...options };
  const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
  const minLevelIndex = levels.indexOf(opts.minLevel ?? 'info');

  const shouldLog = (level: LogLevel): boolean => {
    return levels.indexOf(level) >= minLevelIndex;
  };

  const formatMessage = (level: LogLevel, message: string, meta?: LoggerMeta): string => {
    const parts: string[] = [];

    if (opts.includeTimestamp) {
      parts.push(new Date().toISOString());
    }

    parts.push(level.toUpperCase());
    parts.push(message);

    if (opts.includeContext && meta) {
      const context = formatMeta(meta);
      if (context) {
        parts.push(context);
      }
    }

    return parts.join(' | ');
  };

  return {
    debug(message: string, meta?: LoggerMeta) {
      if (!shouldLog('debug')) return;
      console.debug(formatMessage('debug', message, meta));
    },
    info(message: string, meta?: LoggerMeta) {
      if (!shouldLog('info')) return;
      console.info(formatMessage('info', message, meta));
    },
    warn(message: string, meta?: LoggerMeta) {
      if (!shouldLog('warn')) return;
      console.warn(formatMessage('warn', message, meta));
    },
    error(message: string, meta?: LoggerMeta) {
      if (!shouldLog('error')) return;
      console.error(formatMessage('error', message, meta));
    },
  };
}

function formatMeta(meta: LoggerMeta): string {
  const parts: string[] = [];
  const sensitiveKeys = ['accessToken', 'refreshToken', 'authorization', 'secret'];

  for (const [key, value] of Object.entries(meta)) {
    if (key === 'error') continue;
    
    let displayValue = value;
    if (typeof value === 'string' && sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      displayValue = '[REDACTED]';
    }
    
    parts.push(`${key}=${displayValue}`);
  }

  return parts.length > 0 ? `{ ${parts.join(' ')} }` : '';
}

export const consoleLogger = createLogger({ minLevel: 'debug', prettyPrint: true });

export const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};