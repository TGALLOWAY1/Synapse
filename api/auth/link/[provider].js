import crypto from 'crypto';
import * as github from '../../_lib/github.js';
import * as linkedin from '../../_lib/linkedin.js';
import { getBaseUrl, methodNotAllowed, json } from '../../_lib/response.js';
import { enforceRateLimit } from '../../_lib/rateLimit.js';
import { requireUser } from '../../_lib/requireUser.js';
import { createLinkIntentToken, buildLinkIntentSetCookie } from '../../_lib/linkState.js';

// OAuth init for LINKING an additional sign-in method to the CURRENT account.
// Requires an authenticated session. Identical to /api/auth/<provider> except it
// also drops a signed "link intent" cookie binding the round-trip to this user,
// which the shared callback uses to attach the new identity to this account
// instead of creating/looking-up a separate one.

const PROVIDERS = {
  github: {
    getConfig: github.getGitHubConfig,
    createAuthUrl: github.createGitHubAuthUrl,
    stateCookie: 'synapse_github_state',
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

  const user = await requireUser(req, res);
  if (!user) return; // 401 already sent

  if (
    enforceRateLimit(req, res, {
      scope: `oauth_link_${providerName}`,
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
    const intent = createLinkIntentToken({ userId: user.userId, provider: providerName });
    res.setHeader('Set-Cookie', [
      `${provider.stateCookie}=${state}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`,
      buildLinkIntentSetCookie(intent),
    ]);
    return res.redirect(authUrl);
  } catch (error) {
    console.error(`[${providerName} link init failed]`, error);
    return res.redirect(`/?auth_error=${providerName}_config`);
  }
}
