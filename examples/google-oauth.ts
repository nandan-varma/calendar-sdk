// Real Google OAuth connect flow: a tiny HTTP server that sends the user to Google's
// consent screen, then exchanges the returned code and connects the account.
//
// Needs real credentials - set these first (see .env.example at the repo root):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI (defaults to the localhost one below)
// Run with: pnpm --filter @nandan-varma/calendar-sdk-examples google-oauth
// Then open http://localhost:3000/login in a browser.

import { createServer } from 'node:http';
import { createCalendarSdk } from '@nandan-varma/calendar-sdk';
import { createGoogleProvider } from '@nandan-varma/calendar-sdk-google';
import { createAuthFlow } from '@nandan-varma/calendar-sdk-auth';

const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } = process.env;
const redirectUri = process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3000/auth/google/callback';

if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
  console.log(
    'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET (see .env.example) to run this example against real Google Calendar.'
  );
  process.exit(0);
}

const sdk = createCalendarSdk({
  providers: [
    createGoogleProvider({
      clientId: GOOGLE_CLIENT_ID,
      clientSecret: GOOGLE_CLIENT_SECRET,
      redirectUri,
    }),
  ],
});

const flow = createAuthFlow({
  provider: 'google',
  clientId: GOOGLE_CLIENT_ID,
  clientSecret: GOOGLE_CLIENT_SECRET,
  redirectUri,
  scopes: ['https://www.googleapis.com/auth/calendar'],
});

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost:3000');

  if (url.pathname === '/login') {
    res.writeHead(302, { Location: flow.getAuthorizationUrl() });
    res.end();
    return;
  }

  if (url.pathname === '/auth/google/callback') {
    const code = url.searchParams.get('code');
    if (!code) {
      res.writeHead(400).end('Missing ?code=');
      return;
    }

    const tokens = await flow.exchangeCode(code);
    const account = await sdk.accounts.connect('google', {
      authInput: {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: tokens.expiresAt,
      },
    });

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(`Connected ${account.email} (account id: ${account.id})`);
    return;
  }

  res.writeHead(404).end('Not found. Start at /login.');
});

server.listen(3000, () => {
  console.log('Open http://localhost:3000/login to connect a Google account.');
});
