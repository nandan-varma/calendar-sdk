import type { Account } from '@nandan-varma/calendar-sdk';
import type { GoogleUser } from '../types/index.js';
import { getCapabilitiesForProvider } from '@nandan-varma/calendar-sdk';

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