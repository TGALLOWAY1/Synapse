import crypto from 'crypto';
import { createGoogleAuthUrl, getGoogleConfig } from '../_lib/google.js';
import { getBaseUrl, methodNotAllowed } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  if (enforceRateLimit(req, res, { scope: 'oauth_init_google', limit: 20, windowMs: 60_000 })) return;

  try {
    const baseUrl = getBaseUrl(req);
    const config = getGoogleConfig(baseUrl);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = createGoogleAuthUrl(config, state);

    const secure = process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `synapse_google_state=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
    );
    return res.redirect(authUrl);
  } catch (error) {
    console.error('[Google auth init failed]', error);
    return res.redirect('/?auth_error=google_config');
  }
}
