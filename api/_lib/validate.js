// Lightweight, hand-rolled validators. Zero deps — avoids pulling zod for a few calls.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
const MIN_PASSWORD_LEN = 8;
const MAX_PASSWORD_LEN = 200;
const MAX_NAME_LEN = 120;

export function validateEmail(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Email is required.' };
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return { ok: false, error: 'Email is required.' };
  if (trimmed.length > MAX_EMAIL_LEN) return { ok: false, error: 'Email is too long.' };
  if (!EMAIL_RE.test(trimmed)) return { ok: false, error: 'Please enter a valid email address.' };
  return { ok: true, value: trimmed };
}

export function validatePassword(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Password is required.' };
  if (value.length < MIN_PASSWORD_LEN) {
    return { ok: false, error: `Password must be at least ${MIN_PASSWORD_LEN} characters.` };
  }
  if (value.length > MAX_PASSWORD_LEN) {
    return { ok: false, error: 'Password is too long.' };
  }
  return { ok: true, value };
}

export function validateName(value) {
  if (typeof value !== 'string') return { ok: false, error: 'Name is required.' };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: false, error: 'Name is required.' };
  if (trimmed.length > MAX_NAME_LEN) return { ok: false, error: 'Name is too long.' };
  return { ok: true, value: trimmed };
}

/**
 * Read and JSON-parse the request body. Vercel Node functions sometimes deliver
 * `req.body` already parsed, sometimes as a raw string, and sometimes as a
 * stream depending on the content-type header. Handle all three.
 */
export async function parseJsonBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  if (typeof req.body === 'string' && req.body.length > 0) {
    try {
      return JSON.parse(req.body);
    } catch {
      return {};
    }
  }

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
