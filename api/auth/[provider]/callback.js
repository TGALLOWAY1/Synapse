import * as github from '../../_lib/github.js';
import * as google from '../../_lib/google.js';
import * as linkedin from '../../_lib/linkedin.js';
import { handleOAuthCallback } from '../../_lib/oauthCallback.js';
import { getBaseUrl, json } from '../../_lib/response.js';

// OAuth callback dispatcher. /api/auth/<provider>/callback routes here with
// req.query.provider set. Per-provider quirks (LinkedIn's normalize step
// lives here because the linkedin lib doesn't export one) are kept inline
// so behaviour matches the previous per-provider callback files exactly.

function normalizeLinkedInProfile(profile) {
  const company = profile.organization
    || profile.company
    || profile['https://www.linkedin.com/organization']
    || null;
  const name = profile.name
    || `${profile.given_name || ''} ${profile.family_name || ''}`.trim()
    || profile.email
    || '';
  return {
    providerUserId: profile.sub,
    email: profile.email || null,
    name,
    avatarUrl: profile.picture || null,
    profileUrl: profile.profile || profile.profile_url || null,
    headline: profile.headline || '',
    company,
  };
}

const PROVIDERS = {
  github: {
    getConfig: github.getGitHubConfig,
    exchangeCode: github.exchangeCodeForToken,
    fetchProfile: (token) => github.fetchGitHubProfile(token),
    normalizeProfile: github.normalizeGitHubProfile,
    stateCookie: 'synapse_github_state',
  },
  google: {
    getConfig: google.getGoogleConfig,
    exchangeCode: google.exchangeCodeForToken,
    fetchProfile: (token) => google.fetchGoogleProfile(token),
    normalizeProfile: google.normalizeGoogleProfile,
    stateCookie: 'synapse_google_state',
  },
  linkedin: {
    getConfig: linkedin.getLinkedInConfig,
    exchangeCode: linkedin.exchangeCodeForToken,
    fetchProfile: (token) => linkedin.fetchLinkedInProfile(token),
    normalizeProfile: normalizeLinkedInProfile,
    stateCookie: 'synapse_linkedin_state',
  },
};

export default async function handler(req, res) {
  const providerName = typeof req.query?.provider === 'string' ? req.query.provider : null;
  const provider = providerName ? PROVIDERS[providerName] : null;
  if (!provider) return json(res, 404, { error: 'unknown_provider' });

  const baseUrl = getBaseUrl(req);
  const config = provider.getConfig(baseUrl);

  return handleOAuthCallback(req, res, {
    provider: providerName,
    stateCookieName: provider.stateCookie,
    successRedirect: `/?auth=${providerName}_success`,
    errorRedirectBase: `/?auth_error=${providerName}_`,
    exchangeCode: (code) => provider.exchangeCode(config, code),
    fetchProfile: (tokenResponse) => provider.fetchProfile(tokenResponse.access_token),
    normalizeProfile: provider.normalizeProfile,
  });
}
