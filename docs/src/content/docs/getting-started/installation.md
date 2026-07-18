---
title: Installation
description: Install the calendar-sdk core and the provider adapters you need.
sidebar:
  order: 1
---

calendar-sdk is split into a provider-agnostic core plus one small adapter package per provider. Install the core and only the adapters you need:

```bash
# Google Calendar
npm install @nandan-varma/calendar-sdk @nandan-varma/calendar-sdk-google

# Microsoft Graph (Outlook)
npm install @nandan-varma/calendar-sdk @nandan-varma/calendar-sdk-microsoft

# CalDAV (iCloud, Fastmail, Nextcloud, …)
npm install @nandan-varma/calendar-sdk @nandan-varma/calendar-sdk-caldav
```

Optionally add the OAuth helper package if you want ready-made authorization-URL, code-exchange, and token-refresh utilities for your own auth routes:

```bash
npm install @nandan-varma/calendar-sdk-auth
```

## Requirements

- **Node.js ≥ 18** (the SDK uses the built-in `fetch`, `crypto`, and Web `AbortController` APIs).
- **TypeScript ≥ 5.3** if you consume the types (the core lists TypeScript as a peer dependency).

All packages ship both ESM and CommonJS builds with bundled type declarations, so `import` and `require` both work.

## Your own OAuth credentials

calendar-sdk is *bring-your-own-credentials*: it never proxies traffic through a third-party service.

- For **Google**, create OAuth 2.0 credentials in the [Google Cloud Console](https://console.cloud.google.com) and enable the Google Calendar API. See the [Google provider guide](/providers/google/).
- For **Microsoft**, register an application in the [Azure Portal](https://portal.azure.com) and grant it `Calendars.ReadWrite`. See the [Microsoft provider guide](/providers/microsoft/).
- For **CalDAV**, you only need the server URL and the user's credentials (for iCloud, an app-specific password). See the [CalDAV provider guide](/providers/caldav/).

Next: [Quickstart](/getting-started/quickstart/).
