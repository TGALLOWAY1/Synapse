import {
  exchangeCodeForToken,
  fetchGoogleProfile,
  getGoogleConfig,
  normalizeGoogleProfile,
} from '../../_lib/google.js';
import { handleOAuthCallback } from '../../_lib/oauthCallback.js';
import { getBaseUrl } from '../../_lib/response.js';

export default async function handler(req, res) {
  const baseUrl = getBaseUrl(req);
  const config = getGoogleConfig(baseUrl);

  return handleOAuthCallback(req, res, {
    provider: 'google',
    stateCookieName: 'synapse_google_state',
    successRedirect: '/?auth=google_success',
    errorRedirectBase: '/?auth_error=google_',
    exchangeCode: (code) => exchangeCodeForToken(config, code),
    fetchProfile: (tokenResponse) => fetchGoogleProfile(tokenResponse.access_token),
    normalizeProfile: normalizeGoogleProfile,
  });
}
