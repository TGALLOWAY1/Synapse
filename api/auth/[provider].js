import crypto from 'crypto';
import * as github from '../_lib/github.js';
import * as google from '../_lib/google.js';
import * as linkedin from '../_lib/linkedin.js';
import { getBaseUrl, methodNotAllowed, json } from '../_lib/response.js';
import { enforceRateLimit } from '../_lib/rateLimit.js';

// OAuth init dispatcher. Vercel routes /api/auth/<provider> to this file
// and exposes the matched segment as req.query.provider. The static
// neighbours (login.js, logout.js, signup.js) take precedence over this
// dynamic route in Vercel's filesystem routing, so they keep their own
// handlers. Behaviour is identical to the previous per-provider files
// (cookie names, error redirect format, rate-limit scope all preserved).

const PROVIDERS = {
  github: {
    getConfig: github.getGitHubConfig,
    createAuthUrl: github.createGitHubAuthUrl,
    stateCookie: 'synapse_github_state',
  },
  google: {
    getConfig: google.getGoogleConfig,
    createAuthUrl: google.createGoogleAuthUrl,
    stateCookie: 'synapse_google_state',
  },
  linkedin: {
    getConfig: linkedin.getLinkedInConfig,
    createAuthUrl: linkedin.createLinkedInAuthUrl,
    stateCookie: 'synapse_linkedin_state',
  },
};

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const providerName = typeof req.query?.provider === 'string' ? req.query.provider : null;
  const provider = providerName ? PROVIDERS[providerName] : null;
  if (!provider) return json(res, 404, { error: 'unknown_provider' });

  if (
    enforceRateLimit(req, res, {
      scope: `oauth_init_${providerName}`,
      limit: 20,
      windowMs: 60_000,
    })
  ) {
    return;
  }

  try {
    const baseUrl = getBaseUrl(req);
    const config = provider.getConfig(baseUrl);
    const state = crypto.randomBytes(16).toString('hex');
    const authUrl = provider.createAuthUrl(config, state);

    const secure = process.env.NODE_ENV === 'production';
    res.setHeader(
      'Set-Cookie',
      `${provider.stateCookie}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
    );
    return res.redirect(authUrl);
  } catch (error) {
    console.error(`[${providerName} auth init failed]`, error);
    return res.redirect(`/?auth_error=${providerName}_config`);
  }
}
