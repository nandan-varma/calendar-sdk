import type { ProviderKey, RawProviderData, Extensions } from './common.js';
import type { CapabilityMap } from '../capabilities/index.js';

export type AccountStatus = 'connected' | 'disconnected' | 'expired' | 'error';

export interface Account {
  id: string;
  provider: ProviderKey;
  displayName: string;
  email: string;
  status: AccountStatus;
  capabilities: CapabilityMap;
  raw: RawProviderData;
  extensions: Extensions;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountInput {
  provider: ProviderKey;
  displayName: string;
  email: string;
}

export interface ConnectedAccount extends Account {
  status: 'connected';
}

export interface AuthInput {
  authorizationCode?: string;
  accessToken?: string;
  refreshToken?: string;
  redirectUri?: string;
  scope?: string[];
  /**
   * When connecting with a pre-existing `accessToken` (no `authorizationCode`), pass the
   * token's real expiry if you know it. Without this the SDK cannot know the actual
   * lifetime of a token you obtained yourself, and falls back to a guessed 1-hour expiry
   * (or, with no refresh token, treats the token as never expiring) - either of which can
   * be wrong for a specific token.
   */
  expiresAt?: Date;
}

export interface ConnectOptions {
  authInput: AuthInput;
  scopes?: string[];
  persistTokens?: boolean;
}
