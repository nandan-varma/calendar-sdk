import type { Account } from '@calendar-sdk/core';
import type { GoogleUser } from '../types/index.js';
import { getCapabilitiesForProvider } from '@calendar-sdk/core';

export function mapAccount(user: GoogleUser): Account {
  return {
    id: user.id,
    provider: 'google',
    displayName: user.name || user.email,
    email: user.email,
    status: 'connected',
    capabilities: getCapabilitiesForProvider('google'),
    raw: user,
    extensions: {},
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}