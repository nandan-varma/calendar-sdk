import type { ProviderKey } from '../types/common.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, mapHttpError } from '../errors/index.js';
import { redactSensitive } from '../utils/redact.js';

// Keep in sync with the "version" field in packages/core/package.json - a JSON import here
// would fight the tsup/tsc rootDir setup for a one-line string, so it's tracked manually.
const SDK_VERSION = '0.0.1';

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
  /** Standard verbs or a custom method (e.g. CalDAV's PROPFIND/REPORT). */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | (string & {});
  path: string;
  query?: Record<string, string>;
  headers?: Record<string, string>;
  /** Objects are JSON-serialized; strings (e.g. XML/iCalendar payloads) are sent as-is. */
  body?: unknown;
  /** How to parse a successful response body. Defaults to 'json'. */
  responseType?: 'json' | 'text';
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
  provider: ProviderKey,
  config: TransportConfig = {},
  logger?: Logger
): Transport {
  const { timeout = 30000, headers = {}, retryOptions = defaultRetryOptions, signal } = config;

  const fetchImpl = config.fetch ?? globalThis.fetch.bind(globalThis);

  return {
    async request<T>(options: RequestOptions): Promise<TransportResponse<T>> {
      const {
        method = 'GET',
        path,
        query,
        headers: requestHeaders = {},
        body,
        responseType = 'json',
        timeout: requestTimeout,
        signal: requestSignal,
      } = options;

      const url = buildUrl(config.baseUrl, path, query);

      const mergedHeaders: Record<string, string> = {
        'User-Agent': `calendar-sdk/${SDK_VERSION}`,
        ...headers,
        ...requestHeaders,
      };

      const isStringBody = typeof body === 'string';
      if (body !== undefined && !isStringBody && !hasHeader(mergedHeaders, 'content-type')) {
        mergedHeaders['Content-Type'] = 'application/json';
      }

      const serializedBody =
        body === undefined ? undefined : isStringBody ? (body as string) : JSON.stringify(body);

      // Redaction recursively walks the whole body/headers - skip building it when debug
      // logging won't actually be emitted (the default logger's minLevel is 'info').
      if (logger && (logger.isLevelEnabled?.('debug') ?? true)) {
        logger.debug(`[${provider}] ${method} ${url}`, {
          body: redactSensitive(body),
          headers: redactSensitive(mergedHeaders),
        });
      }

      let lastError: CalendarSdkError | Error | undefined;
      const maxRetries = retryOptions.maxRetries ?? defaultRetryOptions.maxRetries;

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const attemptStart = Date.now();

        // Fresh controller/timeout per attempt: a stale timer from an earlier attempt must
        // never be able to abort a later retry, and every retry needs its own timeout budget.
        const controller = new AbortController();
        const timeoutId = setTimeout(
          () => controller.abort(new Error(`Request timeout after ${requestTimeout ?? timeout}ms`)),
          requestTimeout ?? timeout
        );
        const detachExternalSignal = requestSignal
          ? attachSignal(requestSignal, controller)
          : undefined;

        try {
          const response = await fetchImpl(url, {
            method,
            headers: mergedHeaders,
            body: serializedBody,
            signal: controller.signal,
          });

          const responseHeaders = parseResponseHeaders(response.headers);
          const requestId = responseHeaders['x-request-id'] || responseHeaders['request-id'];

          if (!response.ok) {
            let rawBody: unknown;
            const contentType = response.headers.get('content-type');

            if (contentType?.includes('application/json')) {
              rawBody = await response.json().catch((): null => null);
            } else if (contentType?.includes('text/')) {
              rawBody = await response.text();
            }

            const retryAfterHeader = response.headers.get('retry-after');
            const retryAfter = retryAfterHeader ? Number.parseInt(retryAfterHeader, 10) : undefined;

            const error = mapHttpError(response.status, provider, rawBody, requestId);

            if (error.retryable && attempt < maxRetries) {
              const delay = calculateBackoff(attempt, retryOptions, retryAfter);
              logger?.warn(`[${provider}] Retryable error, retrying in ${delay}ms`, {
                status: response.status,
                attempt,
                maxRetries,
              });
              await sleep(delay);
              continue;
            }

            throw error;
          }

          const data: T =
            response.status === 204
              ? (null as T)
              : responseType === 'text'
                ? ((await response.text()) as unknown as T)
                : ((await response.json()) as T);

          logger?.debug(`[${provider}] Response ${response.status}`, {
            requestId,
            duration: Date.now() - attemptStart,
          });

          return { data, status: response.status, headers: responseHeaders, requestId };
        } catch (error) {
          lastError = error as Error;

          if (error instanceof CalendarSdkError) {
            if (error.retryable && attempt < maxRetries) {
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
            const retryableErrors =
              effectiveRetryOptions?.retryableErrors ?? defaultRetryOptions.retryableErrors;
            const isRetryableError =
              retryableErrors?.some((e) => error.message.includes(e) || error.name === e) ?? false;

            if (isRetryableError && attempt < maxRetries) {
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
        } finally {
          clearTimeout(timeoutId);
          detachExternalSignal?.();
        }
      }

      throw (
        lastError ||
        new CalendarSdkError({
          code: 'INTERNAL_ERROR',
          message: 'Max retries exceeded',
          provider,
        })
      );
    },
  };
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  const target = name.toLowerCase();
  return Object.keys(headers).some((key) => key.toLowerCase() === target);
}

function buildUrl(
  baseUrl: string | undefined,
  path: string,
  query?: Record<string, string>
): string {
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}${path}` : path;

  if (!query || Object.keys(query).length === 0) {
    return url;
  }

  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      params.append(key, value);
    }
  }

  return `${url}?${params.toString()}`;
}

function parseResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key.toLowerCase()] = value;
  });
  return result;
}

function calculateBackoff(attempt: number, options: RetryOptions, retryAfter?: number): number {
  if (retryAfter && !Number.isNaN(retryAfter)) {
    return retryAfter * 1000;
  }

  const delay = Math.min(
    options.initialDelayMs * options.backoffMultiplier ** attempt,
    options.maxDelayMs
  );

  const jitter = Math.random() * 0.3 * delay;
  return Math.floor(delay + jitter);
}

// Forwards abort from a caller-supplied signal onto a per-attempt controller, and returns a
// cleanup function to detach the listener once that attempt is done - without this, every
// attempt would add another listener to the caller's (potentially long-lived) signal.
function attachSignal(external: AbortSignal, controller: AbortController): () => void {
  if (external.aborted) {
    controller.abort(external.reason);
    return () => {};
  }

  const onAbort = () => controller.abort(external.reason);
  external.addEventListener('abort', onAbort, { once: true });
  return () => external.removeEventListener('abort', onAbort);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export { createTransport as default };
