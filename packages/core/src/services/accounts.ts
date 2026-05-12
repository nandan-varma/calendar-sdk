import type { Account, AuthInput, ConnectOptions } from '../types/account.js';
import type { ProviderKey } from '../types/common.js';
import type { ProviderAdapter } from '../adapters/provider.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import { CalendarSdkError, errors } from '../errors/index.js';
import { v4 as uuidv4 } from 'uuid';

export class AccountsService {
  private storage: StorageAdapter;
  private providers: Map<ProviderKey, ProviderAdapter>;
  private logger: Logger;

  constructor(
    storage: StorageAdapter,
    providers: Map<ProviderKey, ProviderAdapter>,
    logger: Logger
  ) {
    this.storage = storage;
    this.providers = providers;
    this.logger = logger;
  }

  async connect(providerKey: ProviderKey, options: ConnectOptions): Promise<Account> {
    const provider = this.providers.get(providerKey);
    if (!provider) {
      throw errors.capabilityUnsupported('Account connection', providerKey);
    }

    this.logger.info('Connecting account', { provider: providerKey });

    try {
      let tokenSet;

      if (options.authInput.authorizationCode) {
        tokenSet = await provider.auth.exchangeCode(
          options.authInput.authorizationCode,
          options.authInput.redirectUri || providerKey
        );
      } else if (options.authInput.accessToken) {
        tokenSet = {
          accessToken: options.authInput.accessToken,
          refreshToken: options.authInput.refreshToken,
          expiresAt: options.authInput.refreshToken ? new Date(Date.now() + 3600000) : undefined,
        };
      } else {
        throw new CalendarSdkError({
          code: 'VALIDATION_FAILED',
          message: 'Either authorizationCode or accessToken is required',
        });
      }

      const accountInfo = await provider.accounts.getAccount(tokenSet);

      const account: Account = {
        id: uuidv4(),
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

      return account;

    } catch (error) {
      this.logger.error('Account connection failed', { provider: providerKey, error });
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

    const provider = this.providers.get(account.provider);
    if (!provider) {
      throw errors.providerError(account.provider, 'Provider not configured');
    }

    const tokens = await this.storage.tokens.get(accountId);
    if (!tokens?.refreshToken) {
      throw errors.authExpired(account.provider, 'No refresh token available');
    }

    this.logger.info('Refreshing account tokens', { accountId });

    try {
      const newTokens = await provider.auth.refreshToken({
        refreshToken: tokens.refreshToken,
      });

      await this.storage.tokens.save(accountId, {
        accessToken: newTokens.accessToken,
        refreshToken: newTokens.refreshToken || tokens.refreshToken,
        expiresAt: newTokens.expiresAt,
        tokenType: newTokens.tokenType,
        scope: newTokens.scope,
      });

      const updatedAccount: Account = {
        ...account,
        status: 'connected',
        updatedAt: new Date(),
      };

      await this.storage.accounts.save(updatedAccount);

      return updatedAccount;

    } catch (error) {
      if (error instanceof CalendarSdkError && (error.code === 'AUTH_EXPIRED' || error.code === 'AUTH_REQUIRED')) {
        await this.storage.accounts.update(accountId, { status: 'expired' });
        throw errors.authExpired(account.provider, 'Failed to refresh authentication');
      }
      throw error;
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
        } catch (error) {
          this.logger.warn('Failed to revoke token', { accountId, error });
        }
      }
    }

    await this.storage.tokens.delete(accountId);
    await this.storage.syncCursors.deleteByAccount(accountId);
    await this.storage.subscriptions.list(accountId).then(subs => 
      Promise.all(subs.map(s => this.storage.subscriptions.delete(s.id)))
    );
    await this.storage.accounts.delete(accountId);

    this.logger.info('Account disconnected', { accountId });
  }

  async getToken(accountId: string): Promise<string | null> {
    const tokens = await this.storage.tokens.get(accountId);
    if (!tokens) {
      return null;
    }

    if (tokens.expiresAt && tokens.expiresAt.getTime() < Date.now()) {
      const account = await this.storage.accounts.get(accountId);
      if (account && account.status === 'connected') {
        try {
          await this.refresh(accountId);
          const refreshed = await this.storage.tokens.get(accountId);
          return refreshed?.accessToken ?? null;
        } catch {
          return null;
        }
      }
      return null;
    }

    return tokens.accessToken;
  }
}