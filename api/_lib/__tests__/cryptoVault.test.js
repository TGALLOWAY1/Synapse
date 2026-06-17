import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  encryptSecret,
  decryptSecret,
  maskKey,
  isVaultConfigured,
  MissingEncryptionSecretError,
} from '../cryptoVault.js';

const SECRET = 'test-encryption-secret-at-least-16-chars-long';

describe('cryptoVault', () => {
  beforeEach(() => {
    process.env.SYNAPSE_KEY_ENCRYPTION_SECRET = SECRET;
  });
  afterEach(() => {
    delete process.env.SYNAPSE_KEY_ENCRYPTION_SECRET;
  });

  it('round-trips a secret', () => {
    const key = 'AIzaSyExampleGeminiKey1234567890';
    const enc = encryptSecret(key, 'user1:gemini');
    expect(enc).not.toContain(key); // ciphertext does not leak plaintext
    expect(enc.startsWith('v1.')).toBe(true);
    expect(decryptSecret(enc, 'user1:gemini')).toBe(key);
  });

  it('produces different ciphertext each time (random IV)', () => {
    const a = encryptSecret('same-key-value', 'u:gemini');
    const b = encryptSecret('same-key-value', 'u:gemini');
    expect(a).not.toBe(b);
    expect(decryptSecret(a, 'u:gemini')).toBe('same-key-value');
    expect(decryptSecret(b, 'u:gemini')).toBe('same-key-value');
  });

  it('fails to decrypt when the AAD (owner/provider) does not match', () => {
    const enc = encryptSecret('sk-secret', 'userA:openai');
    expect(() => decryptSecret(enc, 'userB:openai')).toThrow();
    expect(() => decryptSecret(enc, 'userA:gemini')).toThrow();
  });

  it('fails to decrypt tampered ciphertext', () => {
    const enc = encryptSecret('sk-secret', 'u:openai');
    const parts = enc.split('.');
    // Flip a character in the ciphertext segment.
    parts[3] = parts[3].slice(0, -1) + (parts[3].slice(-1) === 'A' ? 'B' : 'A');
    expect(() => decryptSecret(parts.join('.'), 'u:openai')).toThrow();
  });

  it('fails to decrypt under a different secret', () => {
    const enc = encryptSecret('sk-secret', 'u:openai');
    process.env.SYNAPSE_KEY_ENCRYPTION_SECRET = 'a-completely-different-secret-value';
    expect(() => decryptSecret(enc, 'u:openai')).toThrow();
  });

  it('throws MissingEncryptionSecretError when no secret is set', () => {
    delete process.env.SYNAPSE_KEY_ENCRYPTION_SECRET;
    expect(isVaultConfigured()).toBe(false);
    expect(() => encryptSecret('x', 'u:gemini')).toThrow(MissingEncryptionSecretError);
  });

  it('masks to at most the last 4 characters', () => {
    expect(maskKey('AIzaSy1234abcd')).toBe('…abcd');
    expect(maskKey('abcd')).toBe('…');
    expect(maskKey('')).toBe('');
  });
});
