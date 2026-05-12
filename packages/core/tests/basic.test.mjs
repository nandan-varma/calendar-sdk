import { createCalendarSdk, createMemoryStorage, createLogger } from '../dist/index.js';
import { CalendarSdkError, errors } from '../dist/index.js';
import { getCapabilitiesForProvider } from '../dist/index.js';

console.log('Running basic tests...\n');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (e) {
    console.log(`❌ ${name}: ${e.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

test('SDK creates with empty providers', () => {
  const sdk = createCalendarSdk({
    storage: createMemoryStorage(),
    logger: createLogger({ minLevel: 'error' }),
    providers: [],
  });
  assert(sdk !== null, 'SDK should not be null');
  assert(typeof sdk.accounts.list === 'function', 'accounts.list should be a function');
});

test('Storage adapter works', () => {
  const storage = createMemoryStorage();
  
  const account = {
    id: 'test-1',
    provider: 'google',
    displayName: 'Test User',
    email: 'test@example.com',
    status: 'connected',
    capabilities: getCapabilitiesForProvider('google'),
    raw: {},
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  
  storage.accounts.save(account).then(() => {
    storage.accounts.get('test-1').then(retrieved => {
      assert(retrieved?.id === 'test-1', 'Should retrieve saved account');
    });
  });
});

test('Error codes are correct', () => {
  const error = new CalendarSdkError({
    code: 'AUTH_REQUIRED',
    message: 'Auth required',
    provider: 'google',
    retryable: false,
  });
  
  assert(error.code === 'AUTH_REQUIRED', 'Error code should be AUTH_REQUIRED');
  assert(error.provider === 'google', 'Provider should be google');
  assert(error.retryable === false, 'Should not be retryable');
});

test('Error factory functions work', () => {
  const err = errors.notFound('google', 'Calendar not found');
  assert(err.code === 'NOT_FOUND', 'Should create NOT_FOUND error');
  assert(err.message === 'Calendar not found', 'Should have custom message');
});

test('Capability detection works', () => {
  const caps = getCapabilitiesForProvider('google');
  assert(caps.events.create === true, 'Google should support event creation');
  assert(caps.sync.incremental === true, 'Google should support incremental sync');
  assert(caps.sync.webhook === true, 'Google should support webhooks');
  
  const microsoftCaps = getCapabilitiesForProvider('microsoft');
  assert(microsoftCaps.availability.suggestedTimes === true, 'Microsoft should support meeting suggestions');
  
  const caldavCaps = getCapabilitiesForProvider('caldav');
  assert(caldavCaps.calendars.create === true, 'CalDAV should support calendar creation');
});

test('Error has required properties', () => {
  const err = errors.authRequired('google');
  assert(err.code === 'AUTH_REQUIRED', 'Should have correct code');
  assert(err.provider === 'google', 'Should have provider');
  assert(err.message.length > 0, 'Should have message');
});

console.log(`\n========================================`);
console.log(`Tests: ${passed + failed}`);
console.log(`Passed: ${passed} ✅`);
console.log(`Failed: ${failed} ❌`);
console.log(`========================================`);

if (failed > 0) {
  process.exit(1);
}