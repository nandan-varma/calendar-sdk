// Single source of truth for what "sensitive" means across the transport's request/response
// logging and the structured logger's metadata logging - keeps both redaction paths in sync.
// Substring-matched: safe against false positives (won't collide with unrelated field names).
export const SENSITIVE_KEYS = [
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
  'client_secret',
  'clientsecret',
  'authorization',
  'cookie',
  'x-api-key',
  'password',
];

// Exact-matched: generic names (e.g. `code`, an OAuth authorization code) that would false-positive
// on unrelated fields like `providerErrorCode` or `status code` if matched by substring.
const SENSITIVE_EXACT_KEYS = ['code', 'secret'];

const REDACTED = '[REDACTED]';

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return (
    SENSITIVE_KEYS.some((sk) => normalized.includes(sk)) || SENSITIVE_EXACT_KEYS.includes(normalized)
  );
}

// Redacts sensitive fields in a JSON-serializable object, recursing into nested objects.
function redactObject(value: Record<string, unknown>): Record<string, unknown> {
  const redacted: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    if (isSensitiveKey(key)) {
      redacted[key] = REDACTED;
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      redacted[key] = redactObject(val as Record<string, unknown>);
    } else {
      redacted[key] = val;
    }
  }
  return redacted;
}

// Redacts sensitive fields in an `application/x-www-form-urlencoded` string body, e.g. OAuth
// token exchange payloads (`client_secret=...&refresh_token=...`). Falls back to returning the
// string unchanged if it doesn't parse as form-encoded key/value pairs.
function redactUrlEncoded(value: string): string {
  if (!value.includes('=')) return value;

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(value);
  } catch {
    return value;
  }

  const keys = [...params.keys()];
  if (keys.length === 0) return value;

  for (const key of keys) {
    if (isSensitiveKey(key)) {
      params.set(key, REDACTED);
    }
  }
  return params.toString();
}

// Redacts sensitive values from request/response bodies and metadata before they're logged.
// Handles plain objects (recursively) and urlencoded strings (OAuth token requests); anything
// else (e.g. XML/iCalendar text bodies) is returned unchanged since it has no key/value structure
// to redact against.
export function redactSensitive(value: unknown): unknown {
  if (!value) return value;
  if (typeof value === 'string') return redactUrlEncoded(value);
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(redactSensitive);
  return redactObject(value as Record<string, unknown>);
}
