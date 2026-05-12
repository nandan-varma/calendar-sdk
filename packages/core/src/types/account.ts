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
}

export interface ConnectOptions {
  authInput: AuthInput;
  scopes?: string[];
  persistTokens?: boolean;
}