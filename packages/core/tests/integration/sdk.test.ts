import { describe, it, expect, beforeEach } from 'vitest';
import { createCalendarSdk, createMemoryStorage, createLogger, type CalendarSdk } from '../../src/index.js';

describe('SDK Integration', () => {
  let sdk: CalendarSdk;
  let storage: ReturnType<typeof createMemoryStorage>;

  beforeEach(() => {
    storage = createMemoryStorage();
    sdk = createCalendarSdk({
      storage,
      logger: createLogger({ minLevel: 'error' }),
      providers: [],
    });
  });

  describe('SDK Factory', () => {
    it('should create SDK with empty providers', () => {
      expect(sdk).toBeDefined();
      expect(sdk.accounts).toBeDefined();
      expect(sdk.calendars).toBeDefined();
      expect(sdk.events).toBeDefined();
      expect(sdk.availability).toBeDefined();
      expect(sdk.subscriptions).toBeDefined();
      expect(sdk.sync).toBeDefined();
      expect(sdk.hooks).toBeDefined();
      expect(sdk.storage).toBeDefined();
    });

    it('should expose storage adapter', () => {
      expect(sdk.storage.accounts).toBeDefined();
      expect(sdk.storage.calendars).toBeDefined();
      expect(sdk.storage.events).toBeDefined();
      expect(sdk.storage.syncCursors).toBeDefined();
      expect(sdk.storage.subscriptions).toBeDefined();
      expect(sdk.storage.tokens).toBeDefined();
    });
  });

  describe('Accounts Service', () => {
    it('should have list method', async () => {
      const accounts = await sdk.accounts.list();
      expect(Array.isArray(accounts)).toBe(true);
    });

    it('should have get method', async () => {
      const account = await sdk.accounts.get('non-existent');
      expect(account).toBeNull();
    });

    it('should have connect method', async () => {
      expect(typeof sdk.accounts.connect).toBe('function');
    });

    it('should have disconnect method', async () => {
      expect(typeof sdk.accounts.disconnect).toBe('function');
    });
  });

  describe('Calendars Service', () => {
    it('should have list method', async () => {
      expect(typeof sdk.calendars.list).toBe('function');
    });

    it('should have get method', async () => {
      const calendar = await sdk.calendars.get('non-existent');
      expect(calendar).toBeNull();
    });

    it('should have create method', async () => {
      expect(typeof sdk.calendars.create).toBe('function');
    });

    it('should have update method', async () => {
      expect(typeof sdk.calendars.update).toBe('function');
    });

    it('should have delete method', async () => {
      expect(typeof sdk.calendars.delete).toBe('function');
    });
  });

  describe('Events Service', () => {
    it('should have list method', async () => {
      expect(typeof sdk.events.list).toBe('function');
    });

    it('should have get method', async () => {
      const event = await sdk.events.get('non-existent');
      expect(event).toBeNull();
    });

    it('should have create method', async () => {
      expect(typeof sdk.events.create).toBe('function');
    });

    it('should have update method', async () => {
      expect(typeof sdk.events.update).toBe('function');
    });

    it('should have delete method', async () => {
      expect(typeof sdk.events.delete).toBe('function');
    });

    it('should have move method', async () => {
      expect(typeof sdk.events.move).toBe('function');
    });

    it('should have duplicate method', async () => {
      expect(typeof sdk.events.duplicate).toBe('function');
    });
  });

  describe('Availability Service', () => {
    it('should have freeBusy method', async () => {
      expect(typeof sdk.availability.freeBusy).toBe('function');
    });

    it('should have suggest method', async () => {
      expect(typeof sdk.availability.suggest).toBe('function');
    });
  });

  describe('Subscriptions Service', () => {
    it('should have create method', async () => {
      expect(typeof sdk.subscriptions.create).toBe('function');
    });

    it('should have renew method', async () => {
      expect(typeof sdk.subscriptions.renew).toBe('function');
    });

    it('should have delete method', async () => {
      expect(typeof sdk.subscriptions.delete).toBe('function');
    });

    it('should have list method', async () => {
      expect(typeof sdk.subscriptions.list).toBe('function');
    });

    it('should have get method', async () => {
      expect(typeof sdk.subscriptions.get).toBe('function');
    });
  });

  describe('Sync Service', () => {
    it('should have fullSync method', async () => {
      expect(typeof sdk.sync.fullSync).toBe('function');
    });

    it('should have incrementalSync method', async () => {
      expect(typeof sdk.sync.incrementalSync).toBe('function');
    });

    it('should have reconcile method', async () => {
      expect(typeof sdk.sync.reconcile).toBe('function');
    });
  });

  describe('Hooks', () => {
    it('should have on method', () => {
      expect(typeof sdk.hooks.on).toBe('function');
    });

    it('should have off method', () => {
      expect(typeof sdk.hooks.off).toBe('function');
    });

    it('should have emit method', () => {
      expect(typeof sdk.hooks.emit).toBe('function');
    });

    it('should have once method', () => {
      expect(typeof sdk.hooks.once).toBe('function');
    });

    it('should emit and receive events', async () => {
      const receivedEvents: any[] = [];
      
      sdk.hooks.on('*', (event) => {
        receivedEvents.push(event);
      });

      await sdk.hooks.emit({ type: 'request', event: 'start', provider: 'google', operation: 'list', path: '/calendars', method: 'GET' });

      expect(receivedEvents).toHaveLength(1);
    });
  });

  describe('Logger', () => {
    it('should have getProvider method', () => {
      expect(typeof sdk.getProvider).toBe('function');
    });
  });
});

describe('SDK with Providers', () => {
  it('should accept providers array', () => {
    const sdk = createCalendarSdk({
      storage: createMemoryStorage(),
      logger: createLogger({ minLevel: 'error' }),
      providers: [],
    });

    expect(sdk).toBeDefined();
  });

  it('should accept custom logger options', () => {
    const logger = createLogger({ 
      minLevel: 'debug', 
      includeTimestamp: true,
      redactSensitive: true,
    });

    const sdk = createCalendarSdk({
      storage: createMemoryStorage(),
      logger,
      providers: [],
    });

    expect(sdk).toBeDefined();
  });
});