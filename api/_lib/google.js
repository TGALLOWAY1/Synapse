const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';

export function getGoogleConfig(baseUrl) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${baseUrl}/api/auth/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('Google auth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: ['openid', 'email', 'profile'],
  };
}

export function createGoogleAuthUrl(config, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    access_type: 'online',
    prompt: 'select_account',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(config, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google token exchange failed (${response.status}): ${errBody}`);
  }

  return response.json();
}

export async function fetchGoogleProfile(accessToken) {
  const response = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`Google profile fetch failed (${response.status}): ${errBody}`);
  }

  return response.json();
}

export function normalizeGoogleProfile(profile) {
  const name = profile.name
    || [profile.given_name, profile.family_name].filter(Boolean).join(' ').trim()
    || profile.email
    || '';
  return {
    providerUserId: profile.sub,
    email: profile.email || null,
    name,
    avatarUrl: profile.picture || null,
    profileUrl: null,
    headline: '',
    company: null,
  };
}
