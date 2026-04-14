import crypto from 'crypto';

const SCRYPT_KEY_LENGTH = 64;
const SALT_BYTES = 16;
const SCHEME = 'scrypt';

/**
 * Hash a plaintext password using Node's built-in scrypt.
 * Returns `scrypt$<saltB64url>$<hashB64url>`.
 */
export function hashPassword(plain) {
  if (typeof plain !== 'string' || plain.length === 0) {
    throw new Error('hashPassword: plain password must be a non-empty string');
  }
  const salt = crypto.randomBytes(SALT_BYTES);
  const hash = crypto.scryptSync(plain, salt, SCRYPT_KEY_LENGTH);
  return `${SCHEME}$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

/**
 * Constant-time verify of a plaintext password against a stored scrypt string.
 * Returns false on any parse failure or mismatch.
 */
export function verifyPassword(plain, stored) {
  if (typeof plain !== 'string' || typeof stored !== 'string') return false;

  const parts = stored.split('$');
  if (parts.length !== 3 || parts[0] !== SCHEME) return false;

  try {
    const salt = Buffer.from(parts[1], 'base64url');
    const expected = Buffer.from(parts[2], 'base64url');
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = crypto.scryptSync(plain, salt, expected.length);
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}
