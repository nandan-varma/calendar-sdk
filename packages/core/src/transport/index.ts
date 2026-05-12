import type { ProviderKey } from '../types/common.js';
import { CalendarSdkError, mapHttpError } from '../errors/index.js';

export interface TransportConfig {
  baseUrl?: string;
  timeout?: number;
  headers?: Record<string, string>;
  retryOptions?: RetryOptions;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}

export interface RetryOptions {
  maxRetries: number;
  initialDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableStatuses?: number[];
  retryableErrors?: string[];
}

export const defaultRetryOptions: RetryOptions = {
  maxRetries: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  retryableStatuses: [408, 429, 500, 502, 503, 504],
  retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'ENETUNREACH'],
};

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  timeout?: number;
  signal?: AbortSignal;
}

export interface TransportResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
  requestId?: string;
}

export interface Transport {
  request<T>(options: RequestOptions): Promise<TransportResponse<T>>;
}

export function createTransport(
  config: TransportConfig = {},
  provider: ProviderKey,
  logger?: Logger
): Transport {
  const {
    timeout = 30000,
    headers = {},
    retryOptions = defaultRetryOptions,
    signal,
  } = config;

  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async request<T>(options: RequestOptions): Promise<TransportResponse<T>> {
      const { 
        method = 'GET', 
        path, 
        query, 
        headers: requestHeaders = {}, 
        body, 
        timeout: requestTimeout,
        signal: requestSignal,
      } = options;

      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(new Error(`Request timeout after ${requestTimeout ?? timeout}ms`)),
        requestTimeout ?? timeout
      );

      const combinedSignal = requestSignal 
        ? combineSignals(requestSignal, controller.signal) 
        : controller.signal;

      const url = buildUrl(config.baseUrl, path, query);
      
      const mergedHeaders = {
        'Content-Type': 'application/json',
        'User-Agent': 'calendar-sdk/1.0',
        ...headers,
        ...requestHeaders,
      };

      if (body) {
        mergedHeaders['Content-Type'] = 'application/json';
      }

      logger?.debug(`[${provider}] ${method} ${url}`, { 
        body: redactSensitive(body),
        headers: redactSensitive(mergedHeaders),
      });

      let lastError: CalendarSdkError | Error | undefined;

      for (let attempt = 0; attempt <= (retryOptions.maxRetries ?? defaultRetryOptions.maxRetries); attempt++) {
        try {
          const response = await fetchImpl(url, {
            method,
            headers: mergedHeaders,
            body: body ? JSON.stringify(body) : undefined,
            signal: combinedSignal,
          });

          clearTimeout(timeoutId);

          const responseHeaders = parseResponseHeaders(response.headers);
          const requestId = responseHeaders['x-request-id'] || responseHeaders['request-id'];

          if (!response.ok) {
            let rawBody: unknown;
            const contentType = response.headers.get('content-type');
            
            if (contentType?.includes('application/json')) {
              rawBody = await response.json().catch(() => null);
            } else if (contentType?.includes('text/')) {
              rawBody = await response.text();
            }

            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfter = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;

            const error = mapHttpError(response.status, provider, rawBody, requestId);
            
            if (error.retryable && attempt < (retryOptions.maxRetries ?? defaultRetryOptions.maxRetries)) {
              const delay = calculateBackoff(attempt, retryOptions, retryAfter);
              logger?.warn(`[${provider}] Retryable error, retrying in ${delay}ms`, { 
                status: response.status,
                attempt,
                maxRetries: retryOptions.maxRetries ?? defaultRetryOptions.maxRetries,
              });
              await sleep(delay);
              continue;
            }

            throw error;
          }

          const data: T = response.status === 204 ? (null as T) : await response.json() as T;

          logger?.debug(`[${provider}] Response ${response.status}`, { 
            requestId,
            duration: response.headers.get('x-response-time'),
          });

          return { data, status: response.status, headers: responseHeaders, requestId };

        } catch (error) {
          lastError = error as Error;

          if (error instanceof CalendarSdkError) {
            if (error.retryable && attempt < (retryOptions.maxRetries ?? defaultRetryOptions.maxRetries)) {
              const delay = calculateBackoff(attempt, retryOptions);
              logger?.warn(`[${provider}] Retryable SDK error, retrying in ${delay}ms`, { 
                code: error.code,
                attempt,
              });
              await sleep(delay);
              continue;
            }
            throw error;
          }

          if (error instanceof Error) {
            if (error.name === 'AbortError') {
              throw new CalendarSdkError({
                code: 'NETWORK_ERROR',
                message: 'Request was cancelled',
                provider,
                cause: error,
              });
            }

            const effectiveRetryOptions = retryOptions || defaultRetryOptions;
            const retryableErrors = effectiveRetryOptions?.retryableErrors ?? defaultRetryOptions.retryableErrors;
            const isRetryableError = retryableErrors.some(
              e => error.message.includes(e) || error.name === e
            );

            if (isRetryableError && attempt < (retryOptions.maxRetries ?? defaultRetryOptions.maxRetries)) {
              const delay = calculateBackoff(attempt, retryOptions);
              logger?.warn(`[${provider}] Network error, retrying in ${delay}ms`, { 
                error: error.message,
                attempt,
              });
              await sleep(delay);
              continue;
            }

            throw new CalendarSdkError({
              code: 'NETWORK_ERROR',
              message: error.message,
              provider,
              cause: error,
            });
          }

          throw error;
        }
      }

      throw lastError || new CalendarSdkError({
        code: 'INTERNAL_ERROR',
        message: 'Max retries exceeded',
        provider,
      });
    },
  };
}

function buildUrl(baseUrl: string | undefined, path: string, query?: Record<string, string>): string {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path;
  
  if (!query || Object.keys(query).length === 0) {
    return url;
  }

  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      params.append(key, value);
    }
  });

  return `${url}?${params.toString()}`;
}

function parseResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function calculateBackoff(
  attempt: number,
  options: RetryOptions,
  retryAfter?: number
): number {
  if (retryAfter && !isNaN(retryAfter)) {
    return retryAfter * 1000;
  }

  const delay = Math.min(
    options.initialDelayMs * Math.pow(options.backoffMultiplier, attempt),
    options.maxDelayMs
  );

  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

function combineSignals(s1: AbortSignal, s2: AbortSignal): AbortSignal {
  const controller = new AbortController();
  
  const abort = () => controller.abort();
  
  s1.addEventListener('abort', abort);
  s2.addEventListener('abort', abort);
  
  if (s1.aborted || s2.aborted) {
    controller.abort();
  }

  return controller.signal;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

interface Logger {
  debug(message: string, meta?: object): void;
  warn(message: string, meta?: object): void;
  error(message: string, meta?: object): void;
  info(message: string, meta?: object): void;
}

function redactSensitive(body: unknown): unknown {
  if (!body || typeof body !== 'object') return body;
  
  const obj = body as Record<string, unknown>;
  const sensitiveKeys = ['access_token', 'refresh_token', 'authorization', 'cookie', 'x-api-key'];
  
  const redacted: Record<string, unknown> = {};
  
  for (const [key, value] of Object.entries(obj)) {
    if (sensitiveKeys.some(sk => key.toLowerCase().includes(sk))) {
      redacted[key] = '[REDACTED]';
    } else if (typeof value === 'object') {
      redacted[key] = redactSensitive(value);
    } else {
      redacted[key] = value;
    }
  }
  
  return redacted;
}

export { createTransport as default };