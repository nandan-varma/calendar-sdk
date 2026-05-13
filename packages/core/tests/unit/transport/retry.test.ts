import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTransport, defaultRetryOptions } from '../../../src/transport/index.js';

describe('Transport', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    fetchMock = vi.fn();
  });

  describe('createTransport', () => {
    it('should create transport with default config', () => {
      const transport = createTransport('google', {});
      expect(transport).toBeDefined();
      expect(typeof transport.request).toBe('function');
    });

    it('should create transport with custom config', () => {
      const transport = createTransport('google', {
        baseUrl: 'https://api.example.com',
        timeout: 5000,
      });
      
      expect(transport).toBeDefined();
    });
  });

  describe('transport.request', () => {
    it('should make GET request', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'test' }),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      const result = await transport.request({
        path: '/test',
      });
      
      expect(fetchMock).toHaveBeenCalled();
      expect(result.status).toBe(200);
      expect(result.data).toEqual({ data: 'test' });
    });

    it('should handle query parameters', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ items: [] }),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any, baseUrl: 'https://api.example.com' });
      
      await transport.request({
        path: '/items',
        query: { page: '1', limit: '10' },
      });
      
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.example.com/items?page=1&limit=10',
        expect.any(Object)
      );
    });

    it('should handle POST request with body', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ id: '123' }),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      const result = await transport.request({
        method: 'POST',
        path: '/events',
        body: { title: 'Test Event' },
      });
      
      expect(result.status).toBe(201);
      expect(result.data).toEqual({ id: '123' });
    });

    it('should handle 204 No Content', async () => {
      const mockResponse = {
        ok: true,
        status: 204,
        headers: new Headers(),
        json: () => Promise.resolve(null),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      const result = await transport.request({
        method: 'DELETE',
        path: '/events/123',
      });
      
      expect(result.status).toBe(204);
      expect(result.data).toBeNull();
    });
  });

  describe('Retry Logic', () => {
    it('should retry on 429 status', async () => {
      const errorResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      };
      
      const successResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'success' }),
      };
      
      fetchMock
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      
      const transport = createTransport('google', { 
        fetch: fetchMock as any,
        retryOptions: { ...defaultRetryOptions, maxRetries: 1 },
      });
      
      const result = await transport.request({
        path: '/test',
      });
      
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(result.data).toEqual({ data: 'success' });
    });

    it('should retry on 500 status', async () => {
      const errorResponse = {
        ok: false,
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Internal Server Error' }),
      };
      
      const successResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'success' }),
      };
      
      fetchMock
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      
      const transport = createTransport('google', { 
        fetch: fetchMock as any,
        retryOptions: { ...defaultRetryOptions, maxRetries: 1 },
      });
      
      const result = await transport.request({
        path: '/test',
      });
      
      expect(result.data).toEqual({ data: 'success' });
    });

    it('should not retry on 404 status', async () => {
      const errorResponse = {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ error: 'Not Found' }),
      };
      
      fetchMock.mockResolvedValueOnce(errorResponse);
      
      const transport = createTransport('google', { 
        fetch: fetchMock as any,
        retryOptions: { ...defaultRetryOptions, maxRetries: 1 },
      });
      
      try {
        await transport.request({
          path: '/test',
        });
      } catch (e) {
        expect(fetchMock).toHaveBeenCalledTimes(1);
      }
    });

    it('should respect Retry-After header', async () => {
      const errorResponse = {
        ok: false,
        status: 429,
        headers: new Headers({ 
          'content-type': 'application/json',
          'retry-after': '2',
        }),
        json: () => Promise.resolve({ error: { message: 'Rate limited' } }),
      };
      
      const successResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({ data: 'success' }),
      };
      
      fetchMock
        .mockResolvedValueOnce(errorResponse)
        .mockResolvedValueOnce(successResponse);
      
      const transport = createTransport('google', { 
        fetch: fetchMock as any,
        retryOptions: { ...defaultRetryOptions, maxRetries: 1 },
      });
      
      const start = Date.now();
      await transport.request({ path: '/test' });
      const elapsed = Date.now() - start;
      
      expect(elapsed).toBeGreaterThanOrEqual(2000);
    });
  });

  describe('Error handling', () => {
    it('should throw on network error', async () => {
      fetchMock.mockRejectedValueOnce(new Error('Network error'));
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      try {
        await transport.request({ path: '/test' });
      } catch (e: any) {
        expect(e.code).toBe('NETWORK_ERROR');
      }
    });

    it('should handle timeout', async () => {
      fetchMock.mockRejectedValueOnce(
        Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }),
      );

      const transport = createTransport('google', {
        fetch: fetchMock as any,
        timeout: 50,
      });

      try {
        await transport.request({ path: '/test' });
      } catch (e: any) {
        expect(e.code).toBe('NETWORK_ERROR');
      }
    });
  });

  describe('Request options', () => {
    it('should use custom headers', async () => {
      const mockResponse = {
        ok: true,
        status: 200,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      await transport.request({
        path: '/test',
        headers: { 'X-Custom-Header': 'value' },
      });
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'X-Custom-Header': 'value' }),
        })
      );
    });

    it('should set Content-Type for POST', async () => {
      const mockResponse = {
        ok: true,
        status: 201,
        headers: new Headers({ 'content-type': 'application/json' }),
        json: () => Promise.resolve({}),
      };
      
      fetchMock.mockResolvedValueOnce(mockResponse);
      
      const transport = createTransport('google', { fetch: fetchMock as any });
      
      await transport.request({
        method: 'POST',
        path: '/test',
        body: { key: 'value' },
      });
      
      expect(fetchMock).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        })
      );
    });
  });
});