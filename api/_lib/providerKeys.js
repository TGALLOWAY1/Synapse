import { runMongoAction } from './db.js';
import { encryptSecret, decryptSecret, maskKey } from './cryptoVault.js';

// Server-side store for user-owned provider API keys, encrypted at rest.
// One document per (userId, provider) in the `provider_keys` collection:
//   { userId, provider, ciphertext, last4, createdAt, updatedAt }
//
// `ciphertext` is the only place the key material lives, and it is AES-256-GCM
// encrypted (see cryptoVault.js). `last4` is stored separately purely so the
// settings UI can show a masked preview without ever decrypting.

export const PROVIDER_KEYS_COLLECTION = 'provider_keys';

export const SUPPORTED_PROVIDERS = ['gemini', 'openai'];

export function isSupportedProvider(provider) {
  return SUPPORTED_PROVIDERS.includes(provider);
}

// Generous bounds — real keys are well within these. Rejects empty/garbage and
// caps absurd payloads. Keys must be printable ASCII with no whitespace.
const MIN_KEY_LEN = 8;
const MAX_KEY_LEN = 400;
const KEY_RE = /^[\x21-\x7e]+$/;

export function validateProviderKey(value) {
  if (typeof value !== 'string') return { ok: false, error: 'A key is required.' };
  const trimmed = value.trim();
  if (trimmed.length < MIN_KEY_LEN) return { ok: false, error: 'That key looks too short.' };
  if (trimmed.length > MAX_KEY_LEN) return { ok: false, error: 'That key is too long.' };
  if (!KEY_RE.test(trimmed)) return { ok: false, error: 'That key contains invalid characters.' };
  return { ok: true, value: trimmed };
}

function aadFor(userId, provider) {
  return `${userId}:${provider}`;
}

/**
 * Encrypt and upsert a user's provider key. Returns the masked status for that
 * provider. The plaintext is never persisted, returned, or logged.
 */
export async function setProviderKey(userId, provider, plaintextKey) {
  if (!userId) throw new Error('setProviderKey: userId is required');
  if (!isSupportedProvider(provider)) throw new Error('setProviderKey: unsupported provider');

  const ciphertext = encryptSecret(plaintextKey, aadFor(userId, provider));
  const last4 = maskKey(plaintextKey);
  const now = new Date();

  await runMongoAction('updateOne', {
    collection: PROVIDER_KEYS_COLLECTION,
    filter: { userId, provider },
    update: {
      $set: { userId, provider, ciphertext, last4, updatedAt: now },
      $setOnInsert: { createdAt: now },
    },
    upsert: true,
  });

  return { provider, configured: true, last4, updatedAt: now };
}

/** Remove a user's provider key. Returns true if a document was deleted. */
export async function deleteProviderKey(userId, provider) {
  if (!userId) throw new Error('deleteProviderKey: userId is required');
  if (!isSupportedProvider(provider)) throw new Error('deleteProviderKey: unsupported provider');

  const result = await runMongoAction('deleteOne', {
    collection: PROVIDER_KEYS_COLLECTION,
    filter: { userId, provider },
  });
  return (result?.deletedCount ?? 0) > 0;
}

/**
 * Masked status for every supported provider for a user. Contains NO key
 * material — only `configured`, the last-4 preview, and `updatedAt`. Safe to
 * return to the client.
 */
export async function getProviderKeyStatus(userId) {
  if (!userId) throw new Error('getProviderKeyStatus: userId is required');

  const result = await runMongoAction('find', {
    collection: PROVIDER_KEYS_COLLECTION,
    filter: { userId },
    projection: { _id: 0, provider: 1, last4: 1, updatedAt: 1 },
  });
  const docs = Array.isArray(result?.documents) ? result.documents : [];
  const byProvider = new Map(docs.map((d) => [d.provider, d]));

  const status = {};
  for (const provider of SUPPORTED_PROVIDERS) {
    const doc = byProvider.get(provider);
    status[provider] = doc
      ? { configured: true, last4: doc.last4 ?? '', updatedAt: doc.updatedAt ?? null }
      : { configured: false, last4: '', updatedAt: null };
  }
  return status;
}

/**
 * Decrypt and return a user's provider key for a server-side outbound call.
 * SERVER-ONLY — never expose the return value to a client except via the
 * narrowly-scoped, documented Gemini runtime-key endpoint. Returns null when no
 * key is stored; throws only on a real decrypt failure (tamper / wrong secret).
 */
export async function getDecryptedProviderKey(userId, provider) {
  if (!userId) throw new Error('getDecryptedProviderKey: userId is required');
  if (!isSupportedProvider(provider)) throw new Error('getDecryptedProviderKey: unsupported provider');

  const result = await runMongoAction('findOne', {
    collection: PROVIDER_KEYS_COLLECTION,
    filter: { userId, provider },
    projection: { _id: 0, ciphertext: 1 },
  });
  const ciphertext = result?.document?.ciphertext;
  if (!ciphertext) return null;
  return decryptSecret(ciphertext, aadFor(userId, provider));
}
