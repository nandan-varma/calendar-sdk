export type ProviderKey = 'google' | 'microsoft' | 'caldav';

export interface CapabilityRow {
  group: string;
  label: string;
  support: Record<ProviderKey, boolean>;
}

export const providerLabels: Record<ProviderKey, string> = {
  google: 'Google',
  microsoft: 'Microsoft',
  caldav: 'CalDAV',
};

// Single source of truth for the capability matrix rendered on the
// capabilities guide and (filtered to one column) on each provider page.
export const capabilityRows: CapabilityRow[] = [
  {
    group: 'Calendars',
    label: 'Create / update / delete',
    support: { google: true, microsoft: true, caldav: true },
  },
  {
    group: 'Calendars',
    label: 'Share',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Calendars',
    label: 'Manage notifications',
    support: { google: true, microsoft: false, caldav: false },
  },
  {
    group: 'Events',
    label: 'List / create / update / delete',
    support: { google: true, microsoft: true, caldav: true },
  },
  {
    group: 'Events',
    label: 'Move between calendars',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Events',
    label: 'Duplicate',
    support: { google: true, microsoft: false, caldav: false },
  },
  {
    group: 'Events',
    label: 'Attachments',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Events',
    label: 'Conference data (Meet/Teams)',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Sync',
    label: 'Incremental (syncToken / delta)',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Sync',
    label: 'Webhooks',
    support: { google: true, microsoft: true, caldav: false },
  },
  {
    group: 'Sync',
    label: 'Polling',
    support: { google: true, microsoft: true, caldav: true },
  },
  {
    group: 'Availability',
    label: 'Free/busy',
    support: { google: true, microsoft: true, caldav: true },
  },
  {
    group: 'Availability',
    label: 'Suggested meeting times',
    support: { google: false, microsoft: true, caldav: false },
  },
];
