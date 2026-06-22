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

  const { code, state, error: providerError, error_description: providerErrorDescription } = req.query;

  // If the provider sent us back with ?error=… (LinkedIn's "Bummer, something
  // went wrong" / Google's consent-denied / GitHub's app-blocked all do this),
  // surface that reason instead of misreporting as "missing_code". Log the
  // full description server-side so Vercel logs hold the actionable text.
  if (providerError) {
    console.error(
      `[${provider} callback] provider returned error=${providerError} description=${providerErrorDescription || ''}`,
    );
    const code = String(providerError).toLowerCase().replace(/[^a-z0-9_]/g, '_').slice(0, 64);
    return res.redirect(`${errorRedirectBase}provider_error_${code}`);
  }

  if (!code || !state) {
    console.error(
      `[${provider} callback] missing code/state. queryKeys=${Object.keys(req.query || {}).join(',')}`,
    );
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
