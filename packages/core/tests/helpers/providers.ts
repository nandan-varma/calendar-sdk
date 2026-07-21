import type { ProviderAdapter, TokenSet } from '../../src/types/index.js';
import type { Account } from '../../src/types/account.js';
import { createGoogleProvider } from '@calendar-sdk/google';
import { createMicrosoftProvider } from '@calendar-sdk/microsoft';
import { testEnv, hasGoogleCredentials, hasMicrosoftCredentials } from './env.js';
import {
  interactGoogleOAuth,
  interactMicrosoftOAuth,
  refreshGoogleToken,
  refreshMicrosoftToken,
} from './oauth.js';

export interface TestProvider {
  key: 'google' | 'microsoft';
  adapter: ProviderAdapter;
  token: TokenSet;
  account: Account;
  scopes: string[];
}

export interface TestProviderOptions {
  forceReauth?: boolean;
}

const cachedProviders: Map<string, { provider: TestProvider; timestamp: number }> = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

export async function loadGoogleProvider(options: TestProviderOptions = {}): Promise<TestProvider> {
  const cacheKey = 'google';
  const cached = cachedProviders.get(cacheKey);

  if (!options.forceReauth && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('   (Using cached Google credentials)');
    return cached.provider;
  }

  if (!hasGoogleCredentials()) {
    throw new Error('Google credentials not configured in environment');
  }

  console.log('\n🔄 Loading Google provider...');

  const adapter = createGoogleProvider({
    clientId: testEnv.google.clientId,
    clientSecret: testEnv.google.clientSecret,
  });

  // Try to use stored token or get new one via OAuth
  let token: TokenSet;

  // Check if we have a stored token (from previous test run in same process)
  const globals = globalThis as typeof globalThis & {
    __googleToken?: string;
    __googleRefreshToken?: string;
  };
  const storedToken = globals.__googleToken;
  const storedRefresh = globals.__googleRefreshToken;

  if (storedToken && storedRefresh && !options.forceReauth) {
    try {
      token = await refreshGoogleToken(
        { refreshToken: storedRefresh },
        {
          clientId: testEnv.google.clientId,
          clientSecret: testEnv.google.clientSecret,
        }
      );
      console.log('   ✅ Refreshed existing token');
    } catch (e) {
      console.log('   ⚠️  Token refresh failed, need re-auth');
      token = await interactGoogleOAuth();
    }
  } else {
    token = await interactGoogleOAuth();
  }

  // Cache the refresh token for next test
  globals.__googleToken = token.accessToken;
  globals.__googleRefreshToken = token.refreshToken;

  const account = await adapter.accounts.getAccount(token);

  const provider: TestProvider = {
    key: 'google',
    adapter,
    token,
    account,
    scopes: testEnv.google.scopes,
  };

  cachedProviders.set(cacheKey, { provider, timestamp: Date.now() });

  console.log(`   ✅ Loaded Google account: ${account.email}`);

  return provider;
}

export async function loadMicrosoftProvider(
  options: TestProviderOptions = {}
): Promise<TestProvider> {
  const cacheKey = 'microsoft';
  const cached = cachedProviders.get(cacheKey);

  if (!options.forceReauth && cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log('   (Using cached Microsoft credentials)');
    return cached.provider;
  }

  if (!hasMicrosoftCredentials()) {
    throw new Error('Microsoft credentials not configured in environment');
  }

  console.log('\n🔄 Loading Microsoft provider...');

  const adapter = createMicrosoftProvider({
    clientId: testEnv.microsoft.clientId,
    clientSecret: testEnv.microsoft.clientSecret,
  });

  const globals = globalThis as typeof globalThis & {
    __microsoftToken?: string;
    __microsoftRefreshToken?: string;
  };
  const storedToken = globals.__microsoftToken;
  const storedRefresh = globals.__microsoftRefreshToken;

  let token: TokenSet;

  if (storedToken && storedRefresh && !options.forceReauth) {
    try {
      token = await refreshMicrosoftToken(
        { refreshToken: storedRefresh },
        {
          clientId: testEnv.microsoft.clientId,
          clientSecret: testEnv.microsoft.clientSecret,
        }
      );
      console.log('   ✅ Refreshed existing token');
    } catch (e) {
      console.log('   ⚠️  Token refresh failed, need re-auth');
      token = await interactMicrosoftOAuth();
    }
  } else {
    token = await interactMicrosoftOAuth();
  }

  globals.__microsoftToken = token.accessToken;
  globals.__microsoftRefreshToken = token.refreshToken;

  const account = await adapter.accounts.getAccount(token);

  const provider: TestProvider = {
    key: 'microsoft',
    adapter,
    token,
    account,
    scopes: testEnv.microsoft.scopes,
  };

  cachedProviders.set(cacheKey, { provider, timestamp: Date.now() });

  console.log(`   ✅ Loaded Microsoft account: ${account.email}`);

  return provider;
}

export async function loadAllProviders(options: TestProviderOptions = {}): Promise<TestProvider[]> {
  const providers: TestProvider[] = [];

  if (hasGoogleCredentials()) {
    const google = await loadGoogleProvider(options);
    providers.push(google);
  }

  if (hasMicrosoftCredentials()) {
    const microsoft = await loadMicrosoftProvider(options);
    providers.push(microsoft);
  }

  return providers;
}

export function clearProviderCache(): void {
  cachedProviders.clear();
  const globals = globalThis as typeof globalThis & {
    __googleToken?: string;
    __googleRefreshToken?: string;
    __microsoftToken?: string;
    __microsoftRefreshToken?: string;
  };
  globals.__googleToken = undefined;
  globals.__googleRefreshToken = undefined;
  globals.__microsoftToken = undefined;
  globals.__microsoftRefreshToken = undefined;
}
