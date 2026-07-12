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
