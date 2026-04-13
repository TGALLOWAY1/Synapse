const LINKEDIN_AUTH_URL = 'https://www.linkedin.com/oauth/v2/authorization';
const LINKEDIN_TOKEN_URL = 'https://www.linkedin.com/oauth/v2/accessToken';
const LINKEDIN_USERINFO_URL = 'https://api.linkedin.com/v2/userinfo';

export function getLinkedInConfig(baseUrl) {
  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  const redirectUri = process.env.LINKEDIN_REDIRECT_URI || `${baseUrl}/api/auth/linkedin/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('LinkedIn auth is not configured. Missing LINKEDIN_CLIENT_ID or LINKEDIN_CLIENT_SECRET.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: ['openid', 'profile', 'email'],
  };
}

export function createLinkedInAuthUrl(config, state) {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
  });

  return `${LINKEDIN_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(config, code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(LINKEDIN_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`LinkedIn token exchange failed (${response.status}): ${errBody}`);
  }

  return response.json();
}

export async function fetchLinkedInProfile(accessToken) {
  const response = await fetch(LINKEDIN_USERINFO_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`LinkedIn profile fetch failed (${response.status}): ${errBody}`);
  }

  return response.json();
}
