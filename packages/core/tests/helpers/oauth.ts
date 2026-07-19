import * as readline from 'node:readline';
import type { TokenSet, RefreshToken } from '../../src/types/index.js';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  accessType?: 'online' | 'offline';
  prompt?: 'none' | 'consent' | 'select_account';
}

export async function createGoogleAuthUrl(config: OAuthConfig): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    access_type: config.accessType || 'offline',
    prompt: config.prompt || 'consent',
  });

  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function exchangeGoogleCode(code: string, config: OAuthConfig): Promise<TokenSet> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

export async function refreshGoogleToken(
  token: RefreshToken,
  config: OAuthConfig
): Promise<TokenSet> {
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

export async function createMicrosoftAuthUrl(config: OAuthConfig): Promise<string> {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: config.scopes.join(' '),
    response_mode: 'query',
  });

  return `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?${params}`;
}

export async function exchangeMicrosoftCode(code: string, config: OAuthConfig): Promise<TokenSet> {
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: 'authorization_code',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

export async function refreshMicrosoftToken(
  token: RefreshToken,
  config: OAuthConfig
): Promise<TokenSet> {
  const response = await fetch('https://login.microsoftonline.com/common/oauth2/v2.0/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: token.refreshToken,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || token.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000),
    tokenType: data.token_type,
    scope: data.scope?.split(' ') || [],
  };
}

function createInterface(): readline.Interface {
  return readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
}

export async function promptUser(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface();
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

export async function interactGoogleOAuth(): Promise<TokenSet> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Google OAuth env vars missing');
  }

  const config = {
    clientId,
    clientSecret,
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
    ],
    accessType: 'offline' as const,
    prompt: 'consent' as const,
  };

  const authUrl = await createGoogleAuthUrl(config);

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔐  Google OAuth Authorization Required');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n📍  Please click the link below to sign in:\n');
  console.log(`   ${authUrl}\n`);
  console.log('⬇️  After authorizing, you will be redirected to localhost.');
  console.log('   Copy the "code" parameter from the URL and paste it below.\n');

  const code = await promptUser('   Authorization code: ');

  if (!code) {
    throw new Error('No authorization code provided');
  }

  console.log('\n   🔄 Exchanging code for tokens...\n');

  const tokens = await exchangeGoogleCode(code, config);

  console.log('   ✅ Successfully received tokens!\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  return tokens;
}

export async function interactMicrosoftOAuth(): Promise<TokenSet> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Microsoft OAuth env vars missing');
  }

  const config = {
    clientId,
    clientSecret,
    redirectUri:
      process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback',
    scopes: ['Calendars.ReadWrite', 'User.Read'],
  };

  const authUrl = await createMicrosoftAuthUrl(config);

  console.log('\n');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🔐  Microsoft OAuth Authorization Required');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('\n📍  Please click the link below to sign in:\n');
  console.log(`   ${authUrl}\n`);
  console.log('⬇️  After authorizing, you will be redirected to localhost.');
  console.log('   Copy the "code" parameter from the URL and paste it below.\n');

  const code = await promptUser('   Authorization code: ');

  if (!code) {
    throw new Error('No authorization code provided');
  }

  console.log('\n   🔄 Exchanging code for tokens...\n');

  const tokens = await exchangeMicrosoftCode(code, config);

  console.log('   ✅ Successfully received tokens!\n');
  console.log('═══════════════════════════════════════════════════════════════\n');

  return tokens;
}
