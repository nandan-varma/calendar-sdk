import type { Account, ConnectOptions } from '../types/account.js';
import type { ProviderKey } from '../types/common.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import type { TokenManager } from '../token-manager.js';
import type { Hooks } from '../hooks/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { randomUUID } from 'node:crypto';

export class AccountsService {
  private storage: StorageAdapter;
  private providers: Map<ProviderKey, ProviderAdapter>;
  private logger: Logger;
  private tokenManager: TokenManager;
  private hooks: Hooks;

  constructor(
    storage: StorageAdapter,
    providers: Map<ProviderKey, ProviderAdapter>,
    logger: Logger,
    tokenManager: TokenManager,
    hooks: Hooks
  ) {
    this.storage = storage;
    this.providers = providers;
    this.logger = logger;
    this.tokenManager = tokenManager;
    this.hooks = hooks;
  }

  async connect(providerKey: ProviderKey, options: ConnectOptions): Promise<Account> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw errors.capabilityUnsupported('Account connection', providerKey);
    }

    this.logger.info('Connecting account', { provider: providerKey });

    try {
      let tokenSet: TokenSet;

      if (options.authInput.authorizationCode) {
        tokenSet = await provider.auth.exchangeCode(
          options.authInput.authorizationCode,
          options.authInput.redirectUri || providerKey
        );
      } else if (options.authInput.accessToken) {
        // Prefer the caller's real expiry when they know it; otherwise fall back to a guessed
        // 1-hour lifetime (only meaningful if a refresh token exists to recover with).
        const fallbackExpiresAt = options.authInput.refreshToken
          ? new Date(Date.now() + 3600000)
          : undefined;

        tokenSet = {
          accessToken: options.authInput.accessToken,
          refreshToken: options.authInput.refreshToken,
          expiresAt: options.authInput.expiresAt ?? fallbackExpiresAt,
        };
      } else {
        throw new CalendarSdkError({
          code: 'VALIDATION_FAILED',
          message: 'Either authorizationCode or accessToken is required',
        });
      }

      const accountInfo = await provider.accounts.getAccount(tokenSet);

      const account: Account = {
        id: randomUUID(),
        provider: providerKey,
        displayName: accountInfo.displayName,
        email: accountInfo.email,
        status: 'connected',
        capabilities: provider.getCapabilities(),
        raw: accountInfo.raw,
        extensions: accountInfo.extensions,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      await this.storage.accounts.save(account);

      if (options.persistTokens !== false && tokenSet.refreshToken) {
        await this.storage.tokens.save(account.id, {
          accessToken: tokenSet.accessToken,
          refreshToken: tokenSet.refreshToken,
          expiresAt: tokenSet.expiresAt,
          tokenType: tokenSet.tokenType,
          scope: tokenSet.scope,
        });
      }

      this.logger.info('Account connected successfully', { accountId: account.id, provider: providerKey });
      this.hooks.emit({ type: 'auth', event: 'connected', provider: providerKey, accountId: account.id });

      return account;

    } catch (error) {
      this.logger.error('Account connection failed', { provider: providerKey, error });
      this.hooks.emit({
        type: 'auth',
        event: 'error',
        provider: providerKey,
        accountId: '',
        error: error instanceof CalendarSdkError ? error : undefined,
      });
      throw error;
    }
  }

  async list(): Promise<Account[]> {
    return this.storage.accounts.list();
  }

  async get(accountId: string): Promise<Account | null> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      return null;
    }
    return account;
  }

  async refresh(accountId: string): Promise<Account> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    this.logger.info('Refreshing account tokens', { accountId });

    try {
      await this.tokenManager.refresh(accountId);

      const updatedAccount: Account = {
        ...account,
        status: 'connected',
        updatedAt: new Date(),
      };
      await this.storage.accounts.save(updatedAccount);
      this.hooks.emit({ type: 'auth', event: 'refreshed', provider: account.provider, accountId });

      return updatedAccount;
    } catch (error) {
      await this.storage.accounts.update(accountId, { status: 'expired' });
      const sdkError = errors.authExpired(account.provider, 'Failed to refresh authentication');
      this.hooks.emit({ type: 'auth', event: 'expired', provider: account.provider, accountId, error: sdkError });
      throw sdkError;
    }
  }

  async disconnect(accountId: string): Promise<void> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      return;
    }

    const provider = this.providers.get(account.provider);
    if (provider) {
      const tokens = await this.storage.tokens.get(accountId);
      if (tokens?.accessToken) {
        try {
          await provider.auth.revokeToken(tokens.accessToken);
          this.hooks.emit({ type: 'auth', event: 'revoked', provider: account.provider, accountId });
        } catch (error) {
          this.logger.warn('Failed to revoke token', { accountId, error });
          this.hooks.emit({
            type: 'auth',
            event: 'error',
            provider: account.provider,
            accountId,
            error: error instanceof CalendarSdkError ? error : undefined,
          });
        }
      }
    }

    await this.storage.tokens.delete(accountId);
    await this.storage.syncCursors.deleteByAccount(accountId);
    await this.storage.subscriptions.list(accountId).then(subs =>
      Promise.all(subs.map(s => this.storage.subscriptions.delete(s.id)))
    );
    await this.storage.accounts.delete(accountId);
    this.tokenManager.invalidate(accountId);

    this.logger.info('Account disconnected', { accountId });
  }

  async getToken(accountId: string): Promise<string | null> {
    const token = await this.tokenManager.getToken(accountId);
    return token?.accessToken ?? null;
  }
}
