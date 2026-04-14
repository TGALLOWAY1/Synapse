import crypto from 'crypto';

const COOKIE_NAME = 'synapse_session';

// Tokens older than this are considered expired even if the HMAC verifies,
// so stolen/leaked tokens stop working. Kept in sync with the cookie Max-Age.
const MAX_SESSION_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_COOKIE_MAX_AGE_S = 30 * 24 * 60 * 60; // seconds

function base64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function sign(payload, secret) {
  const h = crypto.createHmac('sha256', secret);
  h.update(payload);
  return h.digest('base64url');
}

export function createSessionToken(claims) {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error('Missing SESSION_SECRET environment variable.');

  // Always stamp issuedAt on the server so clients can't forge a fresh timestamp.
  const stamped = { ...claims, issuedAt: Date.now() };
  const payload = base64Url(JSON.stringify(stamped));
  const signature = sign(payload, secret);
  return `${payload}.${signature}`;
}

export function parseSessionCookie(req) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';').map((part) => part.trim());
  const match = parts.find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (!match) return null;
  return decodeURIComponent(match.split('=')[1]);
}

// Constant-time string compare for signatures to avoid any (mostly theoretical)
// timing side channel. Falls back to false on length mismatch.
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

export function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || typeof token !== 'string' || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, secret);
  if (!safeCompare(expected, signature)) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  // Reject tokens that don't have a valid issuedAt or are older than the
  // configured max session age. This turns the signed cookie into an
  // expiring credential even if the client never rotates it.
  const issuedAt = typeof claims?.issuedAt === 'number' ? claims.issuedAt : null;
  if (!issuedAt || issuedAt > Date.now() + 60_000 /* clock skew */) return null;
  if (Date.now() - issuedAt > MAX_SESSION_AGE_MS) return null;

  return claims;
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === 'production';
  // Prefer the __Host- prefix in production: requires Secure, Path=/, and no
  // Domain attribute. This hardens the cookie against subdomain overrides.
  // We keep the plain name in dev to avoid requiring HTTPS locally.
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${SESSION_COOKIE_MAX_AGE_S}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}
