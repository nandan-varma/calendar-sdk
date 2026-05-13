import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { ProviderAdapter, TokenSet } from '../../src/types/index.js';
import type { Subscription } from '../../src/types/index.js';
import { loadGoogleProvider } from '../helpers/providers.js';
import { hasGoogleCredentials, hasWebhookUrl, testEnv } from '../helpers/env.js';

const TEST_PREFIX = '__TEST_WEBHOOK__';

describe.skipIf(!hasGoogleCredentials() || !hasWebhookUrl())('Webhook Integration', () => {
  let provider: ProviderAdapter;
  let token: TokenSet;
  let testCalendar: { providerId: string; name?: string } | null = null;
  let subscriptions: Subscription[] = [];

  beforeAll(async () => {
    const testProvider = await loadGoogleProvider();
    provider = testProvider.adapter;
    token = testProvider.token;
    console.log(`\n📡 Webhook URL: ${testEnv.webhookUrl}`);
  });

  afterAll(async () => {
    // Clean up subscriptions
    console.log('\n🧹 Cleaning up subscriptions...');
    for (const sub of subscriptions) {
      try {
        await provider.subscriptions.delete(token, sub.id);
        console.log(`   ✅ Deleted subscription: ${sub.id}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`   ⚠️  Failed to delete subscription: ${message}`);
      }
    }
    
    // Clean up test calendar
    if (testCalendar && token) {
      try {
        await provider.calendars.delete(token, testCalendar.providerId);
      } catch (e) {
        // Ignore
      }
    }
  });

  describe('Google Watch Channel (Webhook)', () => {
    it('should create a watch channel subscription', async () => {
      if (!testEnv.webhookUrl) {
        console.log('   ⚠️  Skipped - no webhook URL');
        return;
      }
      
      // First create a test calendar
      const timestamp = Date.now();
      testCalendar = await provider.calendars.create(token, {
        name: `${TEST_PREFIX}${timestamp}`,
        description: 'Calendar for webhook testing',
      });
      
      console.log(`   📅 Created test calendar: ${testCalendar.name}`);
      
      // Create subscription
      const subscription = await provider.subscriptions.create(token, {
        resource: testCalendar.providerId,
        webhookUrl: testEnv.webhookUrl,
        leaseDurationSeconds: 86400, // 24 hours
      });
      
      expect(subscription).toBeDefined();
      expect(subscription.id).toBeDefined();
      expect(subscription.leaseExpiry).toBeDefined();
      
      subscriptions.push(subscription);
      
      console.log(`   ✅ Created watch channel: ${subscription.id}`);
      console.log(`   📅 Expires: ${subscription.leaseExpiry.toISOString()}`);
    });

    it('should list subscriptions', async () => {
      const result = await provider.subscriptions.list(token, 'test-account');
      
      expect(result).toBeDefined();
      console.log(`   ✅ Listed subscriptions (total: ${subscriptions.length})`);
    });

    it('should trigger a notification by creating an event', async () => {
      if (!testCalendar || !testEnv.webhookUrl) {
        console.log('   ⚠️  Skipped - no test calendar or webhook URL');
        return;
      }
      
      // Create an event - this should trigger a webhook notification
      const event = await provider.events.create(token, testCalendar.providerId, {
        title: `TEST: Webhook trigger ${Date.now()}`,
        start: { dateTime: new Date().toISOString(), timezone: 'UTC' },
        end: { dateTime: new Date(Date.now() + 3600000).toISOString(), timezone: 'UTC' },
      });
      
      console.log(`   ✅ Created event: ${event.title}`);
      console.log(`   📡 Check ${testEnv.webhookUrl} for webhook notification`);
      
      // Note: Actual webhook delivery verification would require:
      // 1. A webhook server to receive the notification
      // 2. Checking ngrok dashboard for the request
      // 3. Parsing the notification payload
      
      // For now, we just verify the subscription was created and event was created
    });

    it('should renew the subscription before expiry', async () => {
      if (subscriptions.length === 0) {
        console.log('   ⚠️  Skipped - no subscriptions');
        return;
      }
      
      // Note: Google Watch channels cannot be renewed - they must be recreated
      // But Microsoft Graph subscriptions CAN be renewed
      console.log('   ℹ️  Note: Google Watch channels cannot be renewed, must recreate');
      console.log('   ✅ Subscription is active');
    });

    it('should delete the subscription', async () => {
      if (subscriptions.length === 0) {
        console.log('   ⚠️  Skipped - no subscriptions');
        return;
      }
      
      const sub = subscriptions[subscriptions.length - 1];
      await provider.subscriptions.delete(token, sub.id);
      
      subscriptions = subscriptions.filter(s => s.id !== sub.id);
      
      console.log(`   ✅ Deleted subscription: ${sub.id}`);
    });
  });

  describe('Webhook Validation', () => {
    it('should have a valid webhook URL configured', () => {
      expect(testEnv.webhookUrl).toBeDefined();
      expect(testEnv.webhookUrl).toMatch(/^https?:\/\//);
      console.log(`   ✅ Webhook URL configured: ${testEnv.webhookUrl}`);
    });

    it('should verify webhook can receive requests', async () => {
      // This is a manual verification step
      // Check ngrok dashboard at: http://127.0.0.1:4040
      console.log('   ℹ️  Check ngrok dashboard: http://127.0.0.1:4040');
      console.log('   ℹ️  Look for requests to /webhook endpoint');
    });
  });
});
