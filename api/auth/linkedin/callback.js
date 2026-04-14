import {
  exchangeCodeForToken,
  fetchLinkedInProfile,
  getLinkedInConfig,
} from '../../_lib/linkedin.js';
import { handleOAuthCallback } from '../../_lib/oauthCallback.js';
import { getBaseUrl } from '../../_lib/response.js';

function parseCompany(profile) {
  return (
    profile.organization
    || profile.company
    || profile['https://www.linkedin.com/organization']
    || null
  );
}

function normalizeLinkedInProfile(profile) {
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
    company: parseCompany(profile),
  };
}

export default async function handler(req, res) {
  const baseUrl = getBaseUrl(req);
  const config = getLinkedInConfig(baseUrl);

  return handleOAuthCallback(req, res, {
    provider: 'linkedin',
    stateCookieName: 'synapse_linkedin_state',
    successRedirect: '/?auth=linkedin_success',
    errorRedirectBase: '/?auth_error=linkedin_',
    exchangeCode: (code) => exchangeCodeForToken(config, code),
    fetchProfile: (tokenResponse) => fetchLinkedInProfile(tokenResponse.access_token),
    normalizeProfile: normalizeLinkedInProfile,
  });
}
