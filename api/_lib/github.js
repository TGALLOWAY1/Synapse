const GITHUB_AUTH_URL = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const GITHUB_USER_URL = 'https://api.github.com/user';
const GITHUB_EMAILS_URL = 'https://api.github.com/user/emails';

export function getGitHubConfig(baseUrl) {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  const redirectUri = process.env.GITHUB_REDIRECT_URI || `${baseUrl}/api/auth/github/callback`;

  if (!clientId || !clientSecret) {
    throw new Error('GitHub auth is not configured. Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET.');
  }

  return {
    clientId,
    clientSecret,
    redirectUri,
    scopes: ['read:user', 'user:email'],
  };
}

export function createGitHubAuthUrl(config, state) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: config.scopes.join(' '),
    state,
    allow_signup: 'true',
  });

  return `${GITHUB_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCodeForToken(config, code) {
  const body = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: config.redirectUri,
  });

  const response = await fetch(GITHUB_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`GitHub token exchange failed (${response.status}): ${errBody}`);
  }

  const tokenResponse = await response.json();
  if (tokenResponse.error) {
    throw new Error(`GitHub token exchange error: ${tokenResponse.error_description || tokenResponse.error}`);
  }
  return tokenResponse;
}

async function githubFetch(url, accessToken) {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'synapse-auth',
    },
  });

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`GitHub API ${url} failed (${response.status}): ${errBody}`);
  }

  return response.json();
}

export async function fetchGitHubProfile(accessToken) {
  const [user, emails] = await Promise.all([
    githubFetch(GITHUB_USER_URL, accessToken),
    githubFetch(GITHUB_EMAILS_URL, accessToken).catch((err) => {
      // `user:email` scope may be denied; fall back to the public email on the
      // user record if so.
      console.warn('[GitHub emails fetch failed]', err);
      return [];
    }),
  ]);

  return { user, emails };
}

export function normalizeGitHubProfile({ user, emails }) {
  const primary = Array.isArray(emails)
    ? emails.find((entry) => entry.primary && entry.verified)
      || emails.find((entry) => entry.verified)
      || emails.find((entry) => entry.primary)
    : null;

  const email = primary?.email || user.email || null;
  const name = user.name || user.login || '';

  return {
    providerUserId: String(user.id),
    email,
    name,
    avatarUrl: user.avatar_url || null,
    profileUrl: user.html_url || null,
    headline: user.bio || '',
    company: user.company || null,
  };
}
