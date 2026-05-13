import type { ProviderKey } from '../types/common.js';

export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'CAPABILITY_UNSUPPORTED'
  | 'VALIDATION_FAILED'
  | 'SYNC_CURSOR_EXPIRED'
  | 'SUBSCRIPTION_EXPIRED'
  | 'NETWORK_ERROR'
  | 'PROVIDER_ERROR'
  | 'INTERNAL_ERROR';

export interface CalendarSdkErrorOptions {
  code: ErrorCode;
  message: string;
  provider?: ProviderKey;
  status?: number;
  providerErrorCode?: string;
  requestId?: string;
  retryable?: boolean;
  remediation?: string;
  cause?: Error;
  raw?: unknown;
}

export class CalendarSdkError extends Error {
  public readonly code: ErrorCode;
  public readonly provider?: ProviderKey;
  public readonly status?: number;
  public readonly providerErrorCode?: string;
  public readonly requestId?: string;
  public readonly retryable: boolean;
  public readonly remediation?: string;
  public readonly raw?: unknown;

  constructor(options: CalendarSdkErrorOptions) {
    super(options.message);
    this.name = 'CalendarSdkError';
    this.code = options.code;
    this.provider = options.provider;
    this.status = options.status;
    this.providerErrorCode = options.providerErrorCode;
    this.requestId = options.requestId;
    this.retryable = options.retryable ?? this.computeRetryable(options.code, options.status);
    this.remediation = options.remediation;
    this.raw = options.raw;
    
    if (options.cause) {
      this.cause = options.cause;
    }

    Object.setPrototypeOf(this, CalendarSdkError.prototype);
  }

  private computeRetryable(code: ErrorCode, status?: number): boolean {
    if (status) {
      return status >= 500 || status === 429 || status === 408;
    }
    return code === 'NETWORK_ERROR' || code === 'RATE_LIMITED' || code === 'AUTH_EXPIRED';
  }

  toJSON(): object {
    const payload: Record<string, unknown> = {
      name: this.name,
      code: this.code,
      message: this.message,
      provider: this.provider,
      status: this.status,
      providerErrorCode: this.providerErrorCode,
      requestId: this.requestId,
      retryable: this.retryable,
      remediation: this.remediation,
    };

    if (this.cause && this.cause instanceof Error) {
      payload.cause = this.cause.message;
    }

    return payload;
  }
}

export function isCalendarSdkError(error: unknown): error is CalendarSdkError {
  return error instanceof CalendarSdkError;
}

export function mapHttpError(
  status: number,
  provider: ProviderKey,
  body?: unknown,
  requestId?: string
): CalendarSdkError {
  const code = getErrorCodeFromStatus(status);
  const providerError = extractProviderError(body);
  const remediation = getRemediation(code, provider);

  return new CalendarSdkError({
    code,
    message: providerError.message || getDefaultMessage(code),
    provider,
    status,
    providerErrorCode: providerError.code,
    requestId,
    raw: body,
    remediation,
  });
}

function getErrorCodeFromStatus(status: number): ErrorCode {
  switch (status) {
    case 401: return 'AUTH_REQUIRED';
    case 403: return 'PERMISSION_DENIED';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    case 410: return 'SYNC_CURSOR_EXPIRED';
    default:
      return status >= 500 ? 'PROVIDER_ERROR' : 'NETWORK_ERROR';
  }
}

function extractProviderError(body: unknown): { code?: string; message?: string } {
  if (!body || typeof body !== 'object') return {};
  
  const obj = body as Record<string, unknown>;
  
  if ('error' in obj && typeof obj.error === 'object' && obj.error !== null) {
    const error = obj.error as Record<string, unknown>;
    return {
      code: typeof error.code === 'string' ? error.code : 
            typeof error.message === 'string' ? error.message : undefined,
      message: typeof error.message === 'string' ? error.message : 
               typeof error.description === 'string' ? error.description : undefined,
    };
  }
  
  if ('error_description' in obj) {
    return { message: String(obj.error_description) };
  }
  
  return {};
}

function getDefaultMessage(code: ErrorCode): string {
  const messages: Record<ErrorCode, string> = {
    AUTH_REQUIRED: 'Authentication required. Please reconnect your account.',
    AUTH_EXPIRED: 'Authentication has expired. Please reconnect your account.',
    PERMISSION_DENIED: 'Permission denied. Check your account permissions.',
    NOT_FOUND: 'Resource not found.',
    CONFLICT: 'Resource conflict. The resource may have been modified.',
    RATE_LIMITED: 'Rate limited. Please try again later.',
    CAPABILITY_UNSUPPORTED: 'This feature is not supported by your provider.',
    VALIDATION_FAILED: 'Invalid input. Please check your request.',
    SYNC_CURSOR_EXPIRED: 'Sync token expired. A full sync is required.',
    SUBSCRIPTION_EXPIRED: 'Webhook subscription expired. Please renew.',
    NETWORK_ERROR: 'Network error. Please check your connection.',
    PROVIDER_ERROR: 'Provider error. Please try again.',
    INTERNAL_ERROR: 'Internal SDK error.',
  };
  return messages[code];
}

function getRemediation(code: ErrorCode, provider: ProviderKey): string {
  const remediations: Record<ErrorCode, string> = {
    AUTH_REQUIRED: `Reconnect your ${provider} account to restore access.`,
    AUTH_EXPIRED: `Your ${provider} access token expired. Re-authenticate to continue.`,
    PERMISSION_DENIED: 'Verify your account has the required permissions.',
    NOT_FOUND: 'The resource may have been deleted. Refresh and retry.',
    CONFLICT: 'Resolve the conflict and retry your operation.',
    RATE_LIMITED: 'Implement exponential backoff and retry.',
    CAPABILITY_UNSUPPORTED: 'Check provider capabilities before using this feature.',
    VALIDATION_FAILED: 'Fix validation errors and retry.',
    SYNC_CURSOR_EXPIRED: 'Perform a full sync to obtain a new cursor.',
    SUBSCRIPTION_EXPIRED: 'Renew your webhook subscription.',
    NETWORK_ERROR: 'Check network connectivity and retry.',
    PROVIDER_ERROR: 'Check provider status and retry.',
    INTERNAL_ERROR: 'Contact support if this persists.',
  };
  return remediations[code];
}

export const errors = {
  authRequired: (provider?: ProviderKey, message?: string) => 
    new CalendarSdkError({ code: 'AUTH_REQUIRED', message: message || 'Authentication required', provider }),
  
  authExpired: (provider?: ProviderKey, message?: string) =>
    new CalendarSdkError({ code: 'AUTH_EXPIRED', message: message || 'Authentication expired', provider, retryable: true }),
  
  permissionDenied: (provider?: ProviderKey, message?: string) =>
    new CalendarSdkError({ code: 'PERMISSION_DENIED', message: message || 'Permission denied', provider }),
  
  notFound: (provider?: ProviderKey, message?: string) =>
    new CalendarSdkError({ code: 'NOT_FOUND', message: message || 'Resource not found', provider }),
  
  rateLimited: (provider?: ProviderKey, retryAfter?: number) =>
    new CalendarSdkError({ 
      code: 'RATE_LIMITED', 
      message: 'Rate limit exceeded', 
      provider, 
      retryable: true,
      remediation: retryAfter ? `Retry after ${retryAfter} seconds` : 'Implement exponential backoff',
    }),
  
  providerError: (provider: ProviderKey, message: string, raw?: unknown) =>
    new CalendarSdkError({ code: 'PROVIDER_ERROR', message, provider, raw }),
  
  capabilityUnsupported: (feature: string, provider: ProviderKey) =>
    new CalendarSdkError({ 
      code: 'CAPABILITY_UNSUPPORTED', 
      message: `${feature} is not supported by ${provider}`,
      provider,
      remediation: `Use a different provider or implement custom logic for ${feature}`,
    }),
  
  syncCursorExpired: (provider: ProviderKey) =>
    new CalendarSdkError({ 
      code: 'SYNC_CURSOR_EXPIRED', 
      message: 'Sync token has expired', 
      provider,
      remediation: 'Perform a full sync to obtain a new sync token',
    }),
};
