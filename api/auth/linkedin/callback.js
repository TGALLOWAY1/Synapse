import { runMongoAction } from '../../_lib/db.js';
import { createSessionToken, setSessionCookie } from '../../_lib/session.js';
import { exchangeCodeForToken, fetchLinkedInProfile, getLinkedInConfig } from '../../_lib/linkedin.js';
import { getBaseUrl, methodNotAllowed } from '../../_lib/response.js';

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

function parseCompany(profile) {
  return profile.organization || profile.company || profile['https://www.linkedin.com/organization'];
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res);

  const { code, state } = req.query;
  if (!code || !state) return res.redirect('/?auth_error=missing_code');

  const storedState = readCookie(req, 'synapse_linkedin_state');
  if (!storedState || storedState !== state) return res.redirect('/?auth_error=invalid_state');

  try {
    const baseUrl = getBaseUrl(req);
    const config = getLinkedInConfig(baseUrl);
    const tokenResponse = await exchangeCodeForToken(config, String(code));
    const profile = await fetchLinkedInProfile(tokenResponse.access_token);
    const now = new Date();

    const recruiterRecord = {
      authProvider: 'linkedin',
      linkedinId: profile.sub,
      name: profile.name || `${profile.given_name || ''} ${profile.family_name || ''}`.trim(),
      profileUrl: profile.profile || profile.profile_url || null,
      headline: profile.headline || '',
      company: parseCompany(profile) || null,
      email: profile.email || null,
      avatarUrl: profile.picture || null,
      lastActiveAt: now,
      updatedAt: now,
    };

    await runMongoAction('updateOne', {
      collection: 'recruiters',
      filter: { linkedinId: recruiterRecord.linkedinId },
      update: {
        $set: recruiterRecord,
        $setOnInsert: {
          createdAt: now,
          firstLoginAt: now,
          loginCount: 0,
        },
        $inc: { loginCount: 1 },
      },
      upsert: true,
    });

    await runMongoAction('insertOne', {
      collection: 'recruiter_sessions',
      document: {
        recruiterId: recruiterRecord.linkedinId,
        startedAt: now,
        userAgent: req.headers['user-agent'] || null,
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress || null,
      },
    });

    const sessionToken = createSessionToken({
      recruiterId: recruiterRecord.linkedinId,
      name: recruiterRecord.name,
      profileUrl: recruiterRecord.profileUrl,
      avatarUrl: recruiterRecord.avatarUrl,
      email: recruiterRecord.email,
      issuedAt: Date.now(),
    });

    setSessionCookie(res, sessionToken);
    const sessionCookie = res.getHeader('Set-Cookie');
    res.setHeader('Set-Cookie', [
      `synapse_linkedin_state=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`,
      ...(Array.isArray(sessionCookie) ? sessionCookie : [String(sessionCookie)]),
    ]);
    return res.redirect('/?auth=linkedin_success');
  } catch (error) {
    console.error('[LinkedIn callback failed]', error);
    return res.redirect('/?auth_error=linkedin_callback_failed');
  }
}
