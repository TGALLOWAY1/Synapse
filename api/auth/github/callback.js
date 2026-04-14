import {
  exchangeCodeForToken,
  fetchGitHubProfile,
  getGitHubConfig,
  normalizeGitHubProfile,
} from '../../_lib/github.js';
import { handleOAuthCallback } from '../../_lib/oauthCallback.js';
import { getBaseUrl } from '../../_lib/response.js';

export default async function handler(req, res) {
  const baseUrl = getBaseUrl(req);
  const config = getGitHubConfig(baseUrl);

  return handleOAuthCallback(req, res, {
    provider: 'github',
    stateCookieName: 'synapse_github_state',
    successRedirect: '/?auth=github_success',
    errorRedirectBase: '/?auth_error=github_',
    exchangeCode: (code) => exchangeCodeForToken(config, code),
    fetchProfile: (tokenResponse) => fetchGitHubProfile(tokenResponse.access_token),
    normalizeProfile: normalizeGitHubProfile,
  });
}
