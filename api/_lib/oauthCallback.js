import {
  upsertOAuthUser,
  issueSessionForUser,
  EmailInUseByOtherProviderError,
} from './users.js';
import { methodNotAllowed } from './response.js';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function clearStateCookie(res, name, existingSetCookie) {
  const cleared = `${name}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`;
  const header = existingSetCookie
    ? Array.isArray(existingSetCookie)
      ? [cleared, ...existingSetCookie]
      : [cleared, String(existingSetCookie)]
    : cleared;
  res.setHeader('Set-Cookie', header);
}

/**
 * Shared OAuth callback handler. Each provider supplies:
 *   - provider: 'linkedin' | 'google' | 'github'
 *   - stateCookieName: name of the state cookie set during the redirect
 *   - successRedirect: path to redirect to on success (e.g. '/?auth=google_success')
 *   - errorRedirectBase: path prefix for errors (e.g. '/?auth_error=google_')
 *   - exchangeCode(code, baseUrl): returns { access_token, ... }
 *   - fetchProfile(tokenResponse): returns raw profile object
 *   - normalizeProfile(profile): returns {
 *       providerUserId, email, name, avatarUrl, profileUrl, headline, company
 *     }
 */
export async function handleOAuthCallback(req, res, opts) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const {
    provider,
    stateCookieName,
    successRedirect,
    errorRedirectBase,
    exchangeCode,
    fetchProfile,
    normalizeProfile,
  } = opts;

  const { code, state } = req.query;
  if (!code || !state) {
    return res.redirect(`${errorRedirectBase}missing_code`);
  }

  const storedState = readCookie(req, stateCookieName);
  if (!storedState || storedState !== state) {
    return res.redirect(`${errorRedirectBase}invalid_state`);
  }

  try {
    const tokenResponse = await exchangeCode(String(code));
    const profile = await fetchProfile(tokenResponse);
    const normalized = normalizeProfile(profile);

    if (!normalized.providerUserId) {
      throw new Error(`${provider} profile missing providerUserId`);
    }

    const user = await upsertOAuthUser({
      authProvider: provider,
      providerUserId: String(normalized.providerUserId),
      email: normalized.email || null,
      name: normalized.name || '',
      avatarUrl: normalized.avatarUrl || null,
      profileUrl: normalized.profileUrl || null,
      headline: normalized.headline || '',
      company: normalized.company || null,
    });

    await issueSessionForUser(req, res, user);

    // Clear the state cookie alongside the session cookie that was just set.
    const existing = res.getHeader('Set-Cookie');
    clearStateCookie(res, stateCookieName, existing);

    return res.redirect(successRedirect);
  } catch (error) {
    if (error instanceof EmailInUseByOtherProviderError) {
      return res.redirect('/?auth_error=email_in_use_other_provider');
    }
    console.error(`[${provider} callback failed]`, error);
    return res.redirect(`${errorRedirectBase}callback_failed`);
  }
}
