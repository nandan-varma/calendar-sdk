export interface FreeBusyQuery {
  timeMin: Date;
  timeMax: Date;
  calendars: string[];
  timezone?: string;
  accountId?: string;
}

export interface FreeBusyResult {
  calendars: Record<string, FreeBusyBlock[]>;
  timezone?: string;
  requestId?: string;
}

export type FreeBusyStatus = 'free' | 'busy' | 'tentative' | 'unknown';

export interface FreeBusyBlock {
  start: Date;
  end: Date;
  status: FreeBusyStatus;
  transparency?: 'transparent' | 'opaque';
  busyType?: 'busy' | 'outOfOffice' | 'workingElsewhere';
}

export interface MeetingTimeSuggestion {
  meetingTime: Date;
  confidence: number;
  organizerAvailability: FreeBusyStatus;
  attendeeAvailability: Record<string, FreeBusyStatus>;
  meetingDuration: number;
}

export interface SuggestMeetingQuery {
  timeMin: Date;
  timeMax: Date;
  meetingDuration: number;
  attendees: string[];
  timezone?: string;
  maxCandidates?: number;
  minConfidence?: number;
  organizerConstraint?: 'none' | 'free' | 'busy';
  returnSuggestions?: boolean;
}

export interface SuggestMeetingResult {
  meetingSuggestions: MeetingTimeSuggestion[];
  emptySuggestionsReason?: string;
}

export interface AvailabilityCapabilityMap {
  freeBusy: boolean;
  suggestedTimes: boolean;
  multipleCalendars: boolean;
}
