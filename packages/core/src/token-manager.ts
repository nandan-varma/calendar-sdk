import type { ProviderAdapter, TokenSet } from './adapters/provider.js';
import type { ProviderKey } from './types/common.js';
import type { StorageAdapter } from './storage/index.js';
import type { Logger } from './logger/index.js';
import { errors } from './errors/index.js';

export interface TokenManager {
  /** Cached read; refreshes automatically if the stored token is expired. Returns null if the account has no usable token. */
  getToken(accountId: string): Promise<TokenSet | null>;
  /** Forces a refresh regardless of cached expiry. Throws AUTH_EXPIRED if there's no refresh token or the provider rejects it. */
  refresh(accountId: string): Promise<TokenSet>;
  invalidate(accountId: string): void;
}

// Single source of truth for "cache a token, refresh it if expired" - used by every
// service and by AccountsService.refresh()/getToken() so both paths share one cache.
export function createTokenManager(
  storage: StorageAdapter,
  providers: Map<ProviderKey, ProviderAdapter>,
  logger: Logger
): TokenManager {
  const cache = new Map<string, { token: TokenSet; expiresAt?: Date }>();

  async function refreshNow(accountId: string): Promise<TokenSet> {
    const tokens = await storage.tokens.get(accountId);
    if (!tokens?.refreshToken) {
      throw errors.authExpired(undefined, 'No refresh token available');
    }

    const account = await storage.accounts.get(accountId);
    const provider = account ? providers.get(account.provider) : undefined;
    if (!account || !provider) {
      throw errors.authRequired(account?.provider);
    }

    const newTokens = await provider.auth.refreshToken({ refreshToken: tokens.refreshToken });

    await storage.tokens.save(accountId, {
      accessToken: newTokens.accessToken,
      refreshToken: newTokens.refreshToken || tokens.refreshToken,
      expiresAt: newTokens.expiresAt,
      tokenType: newTokens.tokenType,
      scope: newTokens.scope,
    });

    cache.set(accountId, { token: newTokens, expiresAt: newTokens.expiresAt });
    return newTokens;
  }

  return {
    async getToken(accountId) {
      const cached = cache.get(accountId);
      if (cached?.expiresAt && cached.expiresAt.getTime() > Date.now()) {
        return cached.token;
      }

      const tokens = await storage.tokens.get(accountId);
      if (!tokens) {
        return null;
      }

      if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now()) {
        const account = await storage.accounts.get(accountId);
        if (!account || account.status !== 'connected') {
          return null;
        }
        try {
          return await refreshNow(accountId);
        } catch (error) {
          logger.warn('Token refresh failed', { accountId, error });
          await storage.accounts.update(accountId, { status: 'expired' });
          return null;
        }
      }

      const tokenSet: TokenSet = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
        tokenType: tokens.tokenType,
        scope: tokens.scope,
      };
      cache.set(accountId, { token: tokenSet, expiresAt: tokens.expiresAt });
      return tokenSet;
    },

    refresh: refreshNow,

    invalidate(accountId) {
      cache.delete(accountId);
    },
  };
}
