export interface ErrorCodeEntry {
  code: string;
  meaning: string;
  trigger: string;
  retryable: boolean;
}

// Kept in sync with packages/core/src/errors — see the ErrorCode union and
// the retryability rules described in guides/error-handling.
export const errorCodes: ErrorCodeEntry[] = [
  {
    code: 'AUTH_REQUIRED',
    meaning: 'No usable token',
    trigger: 'HTTP 401, missing/unrefreshable tokens',
    retryable: false,
  },
  {
    code: 'AUTH_EXPIRED',
    meaning: 'Token expired and refresh failed',
    trigger: 'Refresh rejection',
    retryable: true,
  },
  {
    code: 'PERMISSION_DENIED',
    meaning: 'Authenticated but not allowed',
    trigger: 'HTTP 403',
    retryable: false,
  },
  {
    code: 'NOT_FOUND',
    meaning: 'Resource missing',
    trigger: 'HTTP 404; unknown SDK ids',
    retryable: false,
  },
  {
    code: 'CONFLICT',
    meaning: 'Concurrent modification',
    trigger: 'HTTP 409 / etag mismatch',
    retryable: false,
  },
  {
    code: 'RATE_LIMITED',
    meaning: 'Provider throttling',
    trigger: 'HTTP 429',
    retryable: true,
  },
  {
    code: 'CAPABILITY_UNSUPPORTED',
    meaning: 'Feature not supported by this provider',
    trigger: 'Capability check before the network call',
    retryable: false,
  },
  {
    code: 'VALIDATION_FAILED',
    meaning: 'Bad input',
    trigger: 'e.g. connect without code or token',
    retryable: false,
  },
  {
    code: 'SYNC_CURSOR_EXPIRED',
    meaning: 'Sync token invalidated',
    trigger: 'HTTP 410 — run a full sync',
    retryable: false,
  },
  {
    code: 'SUBSCRIPTION_EXPIRED',
    meaning: 'Webhook lease lapsed',
    trigger: 'Renewal missed',
    retryable: false,
  },
  {
    code: 'NETWORK_ERROR',
    meaning: 'Transport-level failure',
    trigger: 'DNS/reset/timeout/abort',
    retryable: true,
  },
  {
    code: 'PROVIDER_ERROR',
    meaning: 'Vendor 5xx or unclassified failure',
    trigger: 'HTTP ≥ 500',
    retryable: true,
  },
  {
    code: 'INTERNAL_ERROR',
    meaning: 'SDK-internal invariant broke',
    trigger: '—',
    retryable: false,
  },
];
