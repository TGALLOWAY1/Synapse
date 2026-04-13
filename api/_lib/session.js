import crypto from 'crypto';

const COOKIE_NAME = 'synapse_session';

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

  const payload = base64Url(JSON.stringify(claims));
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

export function verifySessionToken(token) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || !token || !token.includes('.')) return null;

  const [payload, signature] = token.split('.');
  const expected = sign(payload, secret);
  if (expected !== signature) return null;

  try {
    return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

export function setSessionCookie(res, token) {
  const maxAge = 60 * 60 * 24 * 30;
  const secure = process.env.NODE_ENV === 'production';
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE_NAME}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax`);
}
