import crypto from 'crypto';
import { createGitHubAuthUrl, getGitHubConfig } from '../_lib/github.js';
import { getBaseUrl, methodNotAllowed } from '../_lib/response.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  try {
    const baseUrl = getBaseUrl(req);
    const config = getGitHubConfig(baseUrl);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = createGitHubAuthUrl(config, state);

    const secure = process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `synapse_github_state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    );
    return res.redirect(authUrl);
  } catch (error) {
    console.error('[GitHub auth init failed]', error);
    return res.redirect('/?auth_error=github_config');
  }
}
