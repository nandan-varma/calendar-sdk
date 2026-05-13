export interface TestEnvConfig {
  google: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    scopes: string[];
  };
  microsoft: {
    clientId: string;
    clientSecret: string;
    tenantId: string;
    redirectUri: string;
    scopes: string[];
  };
  webhookUrl: string | undefined;
}

export const testEnv: TestEnvConfig = {
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    redirectUri: process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback',
    scopes: [
      'https://www.googleapis.com/auth/calendar',
      'https://www.googleapis.com/auth/calendar.events',
      'https://www.googleapis.com/auth/calendar.readonly',
    ],
  },
  microsoft: {
    clientId: process.env.MICROSOFT_CLIENT_ID || '',
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || '',
    tenantId: process.env.MICROSOFT_TENANT_ID || 'common',
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || 'http://localhost:3000/auth/microsoft/callback',
    scopes: [
      'Calendars.ReadWrite',
      'Calendars.Read',
      'User.Read',
    ],
  },
  webhookUrl: process.env.TEST_WEBHOOK_URL,
};

export function hasGoogleCredentials(): boolean {
  return !!(testEnv.google.clientId && testEnv.google.clientSecret);
}

export function hasMicrosoftCredentials(): boolean {
  return !!(testEnv.microsoft.clientId && testEnv.microsoft.clientSecret);
}

export function hasWebhookUrl(): boolean {
  return !!testEnv.webhookUrl;
}

export function validateEnv(): string[] {
  const missing: string[] = [];
  
  if (!hasGoogleCredentials()) {
    missing.push('GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET');
  }
  
  if (!hasMicrosoftCredentials()) {
    missing.push('MICROSOFT_CLIENT_ID or MICROSOFT_CLIENT_SECRET');
  }
  
  return missing;
}