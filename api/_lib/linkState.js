import crypto from 'crypto';

// Short-lived, signed "link intent" carried through the OAuth round-trip when a
// SIGNED-IN user connects an additional sign-in method. It binds the OAuth
// callback to a specific account + provider so the just-authenticated provider
// identity is attached to the right account (and can't be replayed against a
// different one). HMAC-signed with the same SESSION_SECRET as the session
// cookie; expires quickly because the whole OAuth dance takes seconds.

const COOKIE_NAME = 'synapse_link_intent';
const MAX_AGE_MS = 10 * 60 * 1000; // 10 minutes
const MAX_AGE_S = 10 * 60;

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  try {
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

export function createLinkIntentToken({ userId, provider }) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Missing SESSION_SECRET environment variable.');
  const payload = Buffer.from(JSON.stringify({ userId, provider, issuedAt: Date.now() })).toString('base64url');
  return `${payload}.${sign(payload, secret)}`;
}

export function verifyLinkIntentToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return null;
  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;
  if (!safeCompare(sign(payload, secret), signature)) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  const issuedAt = typeof claims?.issuedAt === 'number' ? claims.issuedAt : null;
  if (!issuedAt || issuedAt > Date.now() + 60_000) return null;
  if (Date.now() - issuedAt > MAX_AGE_MS) return null;
  if (!claims.userId || !claims.provider) return null;
  return claims;
}

export function readLinkIntentCookie(req) {
  const raw = req.headers.cookie || '';
  const match = raw.split(';').map((p) => p.trim()).find((p) => p.startsWith(`${COOKIE_NAME}=`));
  return match ? decodeURIComponent(match.split('=')[1]) : null;
}

export function buildLinkIntentSetCookie(token) {
  const secure = process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export function buildLinkIntentClearCookie() {
  const secure = process.env.NODE_ENV === 'production';
  return `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export { COOKIE_NAME as LINK_INTENT_COOKIE };
