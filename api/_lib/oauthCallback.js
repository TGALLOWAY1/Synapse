import {
  upsertOAuthUser,
  issueSessionForUser,
  EmailInUseByOtherProviderError,
  findUserByUserId,
  linkProviderIdentity,
} from './users.js';
import { methodNotAllowed } from './response.js';
import { parseSessionCookie, verifySessionToken } from './session.js';
import {
  readLinkIntentCookie,
  verifyLinkIntentToken,
  buildLinkIntentClearCookie,
} from './linkState.js';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

/** Append cleared cookies (state + optional link-intent) to whatever the
 * session step already queued, so all are sent in one Set-Cookie header. */
function appendClearedCookies(res, stateCookieName, extra = []) {
  const cleared = [
    `${stateCookieName}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
    ...extra,
  ];
  const existing = res.getHeader('Set-Cookie');
  const existingArr = existing ? (Array.isArray(existing) ? existing : [String(existing)]) : [];
  res.setHeader('Set-Cookie', [...existingArr, ...cleared]);
}

/**
 * Shared OAuth callback handler. Each provider supplies:
 *   - provider: 'linkedin' | 'github'
 *   - stateCookieName: name of the state cookie set during the redirect
 *   - successRedirect: path to redirect to on success (e.g. '/?auth=github_success')
 *   - errorRedirectBase: path prefix for errors (e.g. '/?auth_error=github_')
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
  // went wrong" / GitHub's app-blocked both do this), surface that reason
  // instead of misreporting as "missing_code". Log the full description
  // server-side so Vercel logs hold the actionable text.
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

  // Is this round-trip a "connect another sign-in method" link, started by an
  // already-signed-in user from Settings? A signed link-intent cookie says so.
  const linkIntent = (() => {
    const raw = readLinkIntentCookie(req);
    if (!raw) return null;
    const claims = verifyLinkIntentToken(raw);
    if (!claims || claims.provider !== provider) return null;
    return claims;
  })();

  try {
    const tokenResponse = await exchangeCode(String(code));
    const profile = await fetchProfile(tokenResponse);
    const normalized = normalizeProfile(profile);

    if (!normalized.providerUserId) {
      throw new Error(`${provider} profile missing providerUserId`);
    }

    const identity = {
      authProvider: provider,
      providerUserId: String(normalized.providerUserId),
      email: normalized.email || null,
      name: normalized.name || '',
      avatarUrl: normalized.avatarUrl || null,
      profileUrl: normalized.profileUrl || null,
      headline: normalized.headline || '',
      company: normalized.company || null,
    };

    if (linkIntent) {
      // Linking path: the new identity is attached to the CURRENTLY signed-in
      // account. Re-verify the live session and require it to match the intent
      // so a stale/forged intent can't bind the identity to the wrong account.
      const sessionClaims = verifySessionToken(parseSessionCookie(req));
      if (!sessionClaims?.userId || sessionClaims.userId !== linkIntent.userId) {
        appendClearedCookies(res, stateCookieName, [buildLinkIntentClearCookie()]);
        return res.redirect(`${errorRedirectBase}link_session_mismatch`);
      }
      const account = await findUserByUserId(linkIntent.userId);
      if (!account) {
        appendClearedCookies(res, stateCookieName, [buildLinkIntentClearCookie()]);
        return res.redirect(`${errorRedirectBase}link_account_missing`);
      }
      const linked = await linkProviderIdentity(account, identity);
      await issueSessionForUser(req, res, linked);
      appendClearedCookies(res, stateCookieName, [buildLinkIntentClearCookie()]);
      return res.redirect('/?auth=linked');
    }

    const user = await upsertOAuthUser(identity);

    await issueSessionForUser(req, res, user);

    // Clear the state cookie alongside the session cookie that was just set.
    appendClearedCookies(res, stateCookieName);

    return res.redirect(successRedirect);
  } catch (error) {
    if (error instanceof EmailInUseByOtherProviderError) {
      const extra = linkIntent ? [buildLinkIntentClearCookie()] : [];
      appendClearedCookies(res, stateCookieName, extra);
      return res.redirect('/?auth_error=email_in_use_other_provider');
    }
    console.error(`[${provider} callback failed]`, error);
    if (linkIntent) appendClearedCookies(res, stateCookieName, [buildLinkIntentClearCookie()]);
    return res.redirect(`${errorRedirectBase}callback_failed`);
  }
}
