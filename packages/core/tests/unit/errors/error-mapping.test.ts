import { describe, it, expect } from 'vitest';
import { CalendarSdkError, errors, mapHttpError, isCalendarSdkError, type ErrorCode } from '../../../src/errors/index.js';

describe('Error Model', () => {
  describe('CalendarSdkError', () => {
    it('should create error with all properties', () => {
      const error = new CalendarSdkError({
        code: 'AUTH_REQUIRED',
        message: 'Authentication required',
        provider: 'google',
        status: 401,
        providerErrorCode: 'invalid_credentials',
        requestId: 'req-123',
        retryable: false,
        remediation: 'Please reconnect your account',
        raw: { error: 'invalid_credentials' },
      });

      expect(error.code).toBe('AUTH_REQUIRED');
      expect(error.message).toBe('Authentication required');
      expect(error.provider).toBe('google');
      expect(error.status).toBe(401);
      expect(error.retryable).toBe(false);
      expect(error.remediation).toBe('Please reconnect your account');
      expect(error.raw).toEqual({ error: 'invalid_credentials' });
    });

    it('should compute retryable from status code', () => {
      const rateLimitError = new CalendarSdkError({
        code: 'RATE_LIMITED',
        message: 'Rate limited',
        status: 429,
      });
      expect(rateLimitError.retryable).toBe(true);

      const serverError = new CalendarSdkError({
        code: 'PROVIDER_ERROR',
        message: 'Server error',
        status: 500,
      });
      expect(serverError.retryable).toBe(true);

      const notFoundError = new CalendarSdkError({
        code: 'NOT_FOUND',
        message: 'Not found',
        status: 404,
      });
      expect(notFoundError.retryable).toBe(false);
    });

    it('should default retryable for specific error codes', () => {
      const networkError = new CalendarSdkError({
        code: 'NETWORK_ERROR',
        message: 'Network error',
      });
      expect(networkError.retryable).toBe(true);

      const authExpired = new CalendarSdkError({
        code: 'AUTH_EXPIRED',
        message: 'Auth expired',
      });
      expect(authExpired.retryable).toBe(true);
    });

    it('should serialize to JSON', () => {
      const error = new CalendarSdkError({
        code: 'NOT_FOUND',
        message: 'Resource not found',
        provider: 'google',
        status: 404,
      });

      const json = error.toJSON();
      expect(json.code).toBe('NOT_FOUND');
      expect(json.provider).toBe('google');
      expect(json.status).toBe(404);
    });

    it('should support cause', () => {
      const cause = new Error('Original error');
      const error = new CalendarSdkError({
        code: 'PROVIDER_ERROR',
        message: 'Provider error',
        cause,
      });

      expect(error.cause).toBe(cause);
    });
  });

  describe('Error factory functions', () => {
    it('should create auth required error', () => {
      const error = errors.authRequired('google');
      expect(error.code).toBe('AUTH_REQUIRED');
      expect(error.provider).toBe('google');
    });

    it('should create auth expired error with retryable', () => {
      const error = errors.authExpired('microsoft');
      expect(error.code).toBe('AUTH_EXPIRED');
      expect(error.retryable).toBe(true);
      expect(error.provider).toBe('microsoft');
    });

    it('should create permission denied error', () => {
      const error = errors.permissionDenied('google', 'Insufficient permissions');
      expect(error.code).toBe('PERMISSION_DENIED');
      expect(error.message).toBe('Insufficient permissions');
    });

    it('should create not found error', () => {
      const error = errors.notFound('caldav', 'Calendar not found');
      expect(error.code).toBe('NOT_FOUND');
      expect(error.provider).toBe('caldav');
    });

    it('should create rate limited error with retry hint', () => {
      const error = errors.rateLimited('google', 60);
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
      expect(error.remediation).toContain('60');
    });

    it('should create provider error with raw data', () => {
      const error = errors.providerError('google', 'API error', { error: 'invalid_request' });
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.raw).toEqual({ error: 'invalid_request' });
    });

    it('should create capability unsupported error', () => {
      const error = errors.capabilityUnsupported('Webhooks', 'caldav');
      expect(error.code).toBe('CAPABILITY_UNSUPPORTED');
      expect(error.message).toContain('Webhooks');
      expect(error.message).toContain('caldav');
    });

    it('should create sync cursor expired error', () => {
      const error = errors.syncCursorExpired('google');
      expect(error.code).toBe('SYNC_CURSOR_EXPIRED');
      expect(error.remediation).toContain('full sync');
    });
  });

  describe('mapHttpError', () => {
    it('should map 401 to AUTH_REQUIRED', () => {
      const error = mapHttpError(401, 'google', { error: { code: 'unauthorized' } });
      expect(error.code).toBe('AUTH_REQUIRED');
      expect(error.status).toBe(401);
    });

    it('should map 403 to PERMISSION_DENIED', () => {
      const error = mapHttpError(403, 'google', { error: { code: 'forbidden' } });
      expect(error.code).toBe('PERMISSION_DENIED');
    });

    it('should map 404 to NOT_FOUND', () => {
      const error = mapHttpError(404, 'google');
      expect(error.code).toBe('NOT_FOUND');
    });

    it('should map 409 to CONFLICT', () => {
      const error = mapHttpError(409, 'google');
      expect(error.code).toBe('CONFLICT');
    });

    it('should map 429 to RATE_LIMITED', () => {
      const error = mapHttpError(429, 'google');
      expect(error.code).toBe('RATE_LIMITED');
      expect(error.retryable).toBe(true);
    });

    it('should map 410 to SYNC_CURSOR_EXPIRED', () => {
      const error = mapHttpError(410, 'google');
      expect(error.code).toBe('SYNC_CURSOR_EXPIRED');
    });

    it('should map 5xx to PROVIDER_ERROR', () => {
      const error = mapHttpError(500, 'google');
      expect(error.code).toBe('PROVIDER_ERROR');
      expect(error.retryable).toBe(true);
    });

    it('should extract provider error codes', () => {
      const error = mapHttpError(400, 'microsoft', { error: { code: 'BadRequest', message: 'Invalid request' } });
      expect(error.providerErrorCode).toBe('BadRequest');
    });

    it('should extract remediation from known errors', () => {
      const error = mapHttpError(401, 'google');
      expect(error.remediation).toBeDefined();
      expect(error.remediation).toContain('google');
    });
  });

  describe('isCalendarSdkError', () => {
    it('should return true for CalendarSdkError', () => {
      const error = new CalendarSdkError({ code: 'NOT_FOUND', message: 'Not found' });
      expect(isCalendarSdkError(error)).toBe(true);
    });

    it('should return false for regular Error', () => {
      const error = new Error('Regular error');
      expect(isCalendarSdkError(error)).toBe(false);
    });

    it('should return false for null', () => {
      expect(isCalendarSdkError(null)).toBe(false);
    });

    it('should return false for object', () => {
      expect(isCalendarSdkError({ code: 'NOT_FOUND' })).toBe(false);
    });
  });

  describe('ErrorCode type', () => {
    it('should have all required error codes', () => {
      const codes: ErrorCode[] = [
        'AUTH_REQUIRED',
        'AUTH_EXPIRED',
        'PERMISSION_DENIED',
        'NOT_FOUND',
        'CONFLICT',
        'RATE_LIMITED',
        'CAPABILITY_UNSUPPORTED',
        'VALIDATION_FAILED',
        'SYNC_CURSOR_EXPIRED',
        'SUBSCRIPTION_EXPIRED',
        'NETWORK_ERROR',
        'PROVIDER_ERROR',
        'INTERNAL_ERROR',
      ];

      codes.forEach(code => {
        const error = new CalendarSdkError({ code, message: 'Test' });
        expect(error.code).toBe(code);
      });
    });
  });
});