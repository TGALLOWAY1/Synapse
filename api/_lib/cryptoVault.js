import crypto from 'crypto';

// Encrypted-at-rest vault for user-owned provider API keys.
//
// Keys are encrypted with AES-256-GCM. The 256-bit data key is derived (scrypt)
// from SYNAPSE_KEY_ENCRYPTION_SECRET, which lives only in the server
// environment — never in the client bundle or the database. Each ciphertext
// uses a fresh random IV and is bound to its owner via AES-GCM "additional
// authenticated data" (AAD = `userId:provider`), so a ciphertext copied to a
// different user/provider row fails authentication instead of decrypting.
//
// Stored string format (all base64url, dot-separated, versioned):
//   v1.<ivB64url>.<authTagB64url>.<ciphertextB64url>

const SCHEME = 'v1';
const ALGO = 'aes-256-gcm';
const IV_BYTES = 12; // 96-bit nonce, the GCM standard
const KEY_BYTES = 32;
const DERIVE_SALT = 'synapse-provider-keys/v1';

export class MissingEncryptionSecretError extends Error {
  constructor() {
    super('SYNAPSE_KEY_ENCRYPTION_SECRET is not configured.');
    this.name = 'MissingEncryptionSecretError';
  }
}

let cachedSecretSource = null;
let cachedKey = null;

/**
 * Derive (and cache) the 32-byte AES key from the env secret. Re-derives if the
 * secret changes (mainly for tests). Throws MissingEncryptionSecretError when
 * the secret is unset or too short to be safe.
 */
function getKey() {
  const secret = process.env.SYNAPSE_KEY_ENCRYPTION_SECRET;
  if (typeof secret !== 'string' || secret.length < 16) {
    throw new MissingEncryptionSecretError();
  }
  if (cachedKey && cachedSecretSource === secret) return cachedKey;
  cachedKey = crypto.scryptSync(secret, DERIVE_SALT, KEY_BYTES);
  cachedSecretSource = secret;
  return cachedKey;
}

/** True when a usable encryption secret is configured. */
export function isVaultConfigured() {
  const secret = process.env.SYNAPSE_KEY_ENCRYPTION_SECRET;
  return typeof secret === 'string' && secret.length >= 16;
}

/**
 * Encrypt `plaintext`, binding it to `aad` (e.g. `userId:provider`). Returns the
 * versioned ciphertext string for storage. The plaintext is never logged.
 */
export function encryptSecret(plaintext, aad = '') {
  if (typeof plaintext !== 'string' || plaintext.length === 0) {
    throw new Error('encryptSecret: plaintext must be a non-empty string');
  }
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    SCHEME,
    iv.toString('base64url'),
    tag.toString('base64url'),
    ct.toString('base64url'),
  ].join('.');
}

/**
 * Decrypt a versioned ciphertext string produced by `encryptSecret`. `aad` must
 * match what was used to encrypt or authentication fails. Returns the plaintext
 * string. Throws on tamper / wrong key / wrong aad — callers treat any throw as
 * "key unavailable" without leaking detail to clients.
 */
export function decryptSecret(stored, aad = '') {
  if (typeof stored !== 'string') throw new Error('decryptSecret: stored must be a string');
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== SCHEME) {
    throw new Error('decryptSecret: unrecognized ciphertext format');
  }
  const key = getKey();
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const ct = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

/**
 * Last-4-character preview for safe status display, e.g. "…cdef". Never returns
 * more than 4 characters of the real key. For very short keys, returns "…".
 */
export function maskKey(plaintext) {
  if (typeof plaintext !== 'string' || plaintext.length === 0) return '';
  const tail = plaintext.slice(-4);
  return plaintext.length <= 4 ? '…' : `…${tail}`;
}
