import type { ProviderKey } from '../types/common.js';
import type { CalendarEvent } from '../types/event.js';
import type { Subscription } from '../types/subscription.js';
import type { CalendarSdkError } from '../errors/index.js';

export type HookEvent = 
  | RequestHookEvent
  | SyncHookEvent
  | SubscriptionHookEvent
  | AuthHookEvent
  | ErrorHookEvent
  | RateLimitHookEvent;

export interface RequestHookEvent {
  type: 'request';
  event: 'start' | 'end';
  provider: ProviderKey;
  accountId?: string;
  operation: string;
  path: string;
  method: string;
  duration?: number;
  status?: number;
  requestId?: string;
  retryCount?: number;
  error?: CalendarSdkError;
}

export interface SyncHookEvent {
  type: 'sync';
  event: 'start' | 'end' | 'progress';
  provider: ProviderKey;
  accountId: string;
  scope: string;
  cursorToken?: string;
  created?: number;
  updated?: number;
  deleted?: number;
  duration?: number;
  error?: CalendarSdkError;
}

export interface SubscriptionHookEvent {
  type: 'subscription';
  event: 'created' | 'renewed' | 'expired' | 'deleted' | 'notification';
  provider: ProviderKey;
  accountId: string;
  subscription: Subscription;
  notification?: SubscriptionNotification;
}

export interface SubscriptionNotification {
  subscriptionId: string;
  timestamp: Date;
  resource: string;
  changes?: { type: string; resourceId: string }[];
}

export interface AuthHookEvent {
  type: 'auth';
  event: 'connected' | 'refreshed' | 'expired' | 'revoked' | 'error';
  provider: ProviderKey;
  accountId: string;
  error?: CalendarSdkError;
}

export interface ErrorHookEvent {
  type: 'error';
  provider: ProviderKey;
  accountId?: string;
  operation: string;
  error: CalendarSdkError;
  retryable: boolean;
  retryCount?: number;
}

export interface RateLimitHookEvent {
  type: 'rate_limit';
  provider: ProviderKey;
  accountId?: string;
  operation: string;
  retryAfter?: number;
  limit?: number;
  remaining?: number;
}

export type HookCallback = (event: HookEvent) => void | Promise<void>;

export interface Hooks {
  on(event: '*' | HookEvent['type'], callback: HookCallback): void;
  off(event: '*' | HookEvent['type'], callback: HookCallback): void;
  emit(event: HookEvent): void | Promise<void>;
  once(event: '*' | HookEvent['type'], callback: HookCallback): void;
}

export function createHooks(): Hooks {
  const handlers = new Map<string, Set<HookCallback>>();

  return {
    on(event: '*' | HookEvent['type'], callback: HookCallback) {
      const key = event === '*' ? '*' : event;
      if (!handlers.has(key)) {
        handlers.set(key, new Set());
      }
      handlers.get(key)!.add(callback);
    },

    off(event: '*' | HookEvent['type'], callback: HookCallback) {
      const key = event === '*' ? '*' : event;
      handlers.get(key)?.delete(callback);
    },

    emit(event: HookEvent): void | Promise<void> {
      const callbacks: HookCallback[] = [];
      
      if (handlers.has('*')) {
        handlers.get('*')!.forEach(cb => callbacks.push(cb));
      }
      
      if (handlers.has(event.type)) {
        handlers.get(event.type)!.forEach(cb => callbacks.push(cb));
      }

      for (const callback of callbacks) {
        try {
          const result = callback(event);
          if (result instanceof Promise) {
            return result;
          }
        } catch (error) {
          console.error('Hook callback error:', error);
        }
      }
    },

    once(event: '*' | HookEvent['type'], callback: HookCallback) {
      const wrappedCallback: HookCallback = (e) => {
        this.off(event, wrappedCallback);
        return callback(e);
      };
      this.on(event, wrappedCallback);
    },
  };
}

export interface EventEmitterOptions {
  async?: boolean;
  errorHandler?: (error: Error) => void;
}

export class EventEmitter implements Hooks {
  private handlers: Map<string, Set<HookCallback>> = new Map();
  private options: EventEmitterOptions;

  constructor(options: EventEmitterOptions = {}) {
    this.options = options;
  }

  on(event: '*' | HookEvent['type'], callback: HookCallback): void {
    const key = event === '*' ? '*' : event;
    if (!this.handlers.has(key)) {
      this.handlers.set(key, new Set());
    }
    this.handlers.get(key)!.add(callback);
  }

  off(event: '*' | HookEvent['type'], callback: HookCallback): void {
    const key = event === '*' ? '*' : event;
    this.handlers.get(key)?.delete(callback);
  }

  emit(event: HookEvent): void | Promise<void> {
    const key = event.type;
    const wildcard = this.handlers.get('*');
    const specific = this.handlers.get(key);
    const callbacks = [...(wildcard || []), ...(specific || [])];

    if (this.options.async) {
      return this.emitAsync(callbacks, event);
    }

    return this.emitSync(callbacks, event);
  }

  private emitSync(callbacks: HookCallback[], event: HookEvent): void {
    for (const callback of callbacks) {
      try {
        callback(event);
      } catch (error) {
        this.options.errorHandler?.(error as Error);
      }
    }
  }

  private async emitAsync(callbacks: HookCallback[], event: HookEvent): Promise<void> {
    for (const callback of callbacks) {
      try {
        await callback(event);
      } catch (error) {
        this.options.errorHandler?.(error as Error);
      }
    }
  }

  once(event: '*' | HookEvent['type'], callback: HookCallback): void {
    const wrappedCallback: HookCallback = (e) => {
      this.off(event, wrappedCallback);
      return callback(e);
    };
    this.on(event, wrappedCallback);
  }
}