import { describe, it, expect, vi } from 'vitest';
import { createHooks, EventEmitter } from '../../../src/hooks/index.js';
import type { HookEvent } from '../../../src/hooks/index.js';

function authEvent(overrides: Partial<HookEvent> = {}): HookEvent {
  return {
    type: 'auth',
    event: 'connected',
    provider: 'google',
    accountId: 'account-1',
    ...overrides,
  } as HookEvent;
}

describe('createHooks', () => {
  it('regression: invokes every listener even when an earlier one is async', async () => {
    const hooks = createHooks();
    const order: string[] = [];

    hooks.on('auth', async () => {
      order.push('first-async');
    });
    hooks.on('auth', () => {
      order.push('second-sync');
    });
    hooks.on('auth', async () => {
      order.push('third-async');
    });

    await hooks.emit(authEvent());

    expect(order).toEqual(['first-async', 'second-sync', 'third-async']);
  });

  it('invokes both wildcard and event-specific listeners', async () => {
    const wildcard = vi.fn();
    const specific = vi.fn();
    const hooks = createHooks();

    hooks.on('*', wildcard);
    hooks.on('auth', specific);

    await hooks.emit(authEvent());

    expect(wildcard).toHaveBeenCalledTimes(1);
    expect(specific).toHaveBeenCalledTimes(1);
  });

  it('does not invoke a listener after off() removes it', async () => {
    const callback = vi.fn();
    const hooks = createHooks();

    hooks.on('auth', callback);
    hooks.off('auth', callback);
    await hooks.emit(authEvent());

    expect(callback).not.toHaveBeenCalled();
  });

  it('once() only fires a single time', async () => {
    const callback = vi.fn();
    const hooks = createHooks();

    hooks.once('auth', callback);
    await hooks.emit(authEvent());
    await hooks.emit(authEvent());

    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('does not let one listener throwing prevent the others from running', async () => {
    const hooks = createHooks();
    const second = vi.fn();

    hooks.on('auth', () => {
      throw new Error('boom');
    });
    hooks.on('auth', second);

    await hooks.emit(authEvent());

    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe('EventEmitter', () => {
  it('invokes every listener even when an earlier one is async, when constructed with async: true', async () => {
    const emitter = new EventEmitter({ async: true });
    const order: string[] = [];

    emitter.on('auth', async () => {
      order.push('first');
    });
    emitter.on('auth', async () => {
      order.push('second');
    });

    await emitter.emit(authEvent());

    expect(order).toEqual(['first', 'second']);
  });

  it('routes callback errors to the configured errorHandler', async () => {
    const errorHandler = vi.fn();
    const emitter = new EventEmitter({ async: true, errorHandler });

    emitter.on('auth', () => {
      throw new Error('boom');
    });
    await emitter.emit(authEvent());

    expect(errorHandler).toHaveBeenCalledTimes(1);
  });
});
