import type { FreeBusyQuery, FreeBusyResult, SuggestMeetingQuery, SuggestMeetingResult } from '../types/availability.js';
import type { ProviderAdapter, TokenSet } from '../adapters/provider.js';
import type { ProviderKey } from '../types/common.js';
import type { StorageAdapter } from '../storage/index.js';
import type { Logger } from '../logger/index.js';
import { errors } from '../errors/index.js';

export class AvailabilityService {
  private storage: StorageAdapter;
  private getToken: (accountId: string) => Promise<TokenSet | null>;
  private getProvider: (providerKey: ProviderKey) => ProviderAdapter;
  private logger: Logger;

  constructor(
    storage: StorageAdapter,
    getToken: (accountId: string) => Promise<TokenSet | null>,
    getProvider: (providerKey: ProviderKey) => ProviderAdapter,
    logger: Logger
  ) {
    this.storage = storage;
    this.getToken = getToken;
    this.getProvider = getProvider;
    this.logger = logger;
  }

  async freeBusy(accountId: string, query: FreeBusyQuery): Promise<FreeBusyResult> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.availability;
    if (!caps.freeBusy) {
      throw errors.capabilityUnsupported('Free/busy lookup', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.debug('Fetching free/busy', { accountId, timeMin: query.timeMin, timeMax: query.timeMax });

    const result = await provider.availability.freeBusy(token, query);

    return result;
  }

  async suggest(accountId: string, query: SuggestMeetingQuery): Promise<SuggestMeetingResult> {
    const account = await this.storage.accounts.get(accountId);
    if (!account) {
      throw errors.notFound(undefined, 'Account not found');
    }

    const caps = account.capabilities.availability;
    if (!caps.suggestedTimes) {
      throw errors.capabilityUnsupported('Meeting time suggestions', account.provider);
    }

    const provider = this.getProvider(account.provider);
    const token = await this.getToken(accountId);
    if (!token) {
      throw errors.authRequired(account.provider);
    }

    this.logger.debug('Getting meeting time suggestions', { accountId, attendees: query.attendees.length });

    const result = await provider.availability.suggestMeeting(token, query);

    return result;
  }
}
