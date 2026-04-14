import crypto from 'crypto';
import { createLinkedInAuthUrl, getLinkedInConfig } from '../_lib/linkedin.js';
import { getBaseUrl, methodNotAllowed } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  if (enforceRateLimit(req, res, { scope: 'oauth_init_linkedin', limit: 20, windowMs: 60_000 })) return;

  try {
    const baseUrl = getBaseUrl(req);
    const config = getLinkedInConfig(baseUrl);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = createLinkedInAuthUrl(config, state);

    const secure = process.env.NODE_ENV === 'production';
    res.setHeader('Set-Cookie', `synapse_linkedin_state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`);
    return res.redirect(authUrl);
  } catch (error) {
    console.error('[LinkedIn auth init failed]', error);
    return res.redirect('/?auth_error=linkedin_config');
  }
}
