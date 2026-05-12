import { createCalendarSdk, createMemoryStorage, createLogger } from './packages/core/dist/index.js';

const logger = createLogger({ minLevel: 'debug', prettyPrint: true });

const storage = createMemoryStorage();

const sdk = createCalendarSdk({
  storage,
  logger,
  providers: [],
});

console.log('✅ SDK created successfully');
console.log('📦 Available services:', Object.keys(sdk).filter(k => typeof sdk[k] === 'object'));

console.log('📋 Storage interfaces:', Object.keys(sdk.storage));

console.log('✅ All core modules loaded!');