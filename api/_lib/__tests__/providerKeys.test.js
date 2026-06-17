import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

// Mock the Mongo Data API layer so these are pure unit tests.
const runMongoAction = vi.fn();
vi.mock('../db.js', () => ({ runMongoAction: (...a) => runMongoAction(...a) }));

import {
  setProviderKey,
  getProviderKeyStatus,
  getDecryptedProviderKey,
  validateProviderKey,
} from '../providerKeys.js';
import { encryptSecret } from '../cryptoVault.js';

const SECRET = 'unit-test-encryption-secret-1234567890';

describe('providerKeys', () => {
  beforeEach(() => {
    process.env.SYNAPSE_KEY_ENCRYPTION_SECRET = SECRET;
    runMongoAction.mockReset();
  });
  afterEach(() => {
    delete process.env.SYNAPSE_KEY_ENCRYPTION_SECRET;
  });

  it('stores an ENCRYPTED key (never plaintext), scoped to the userId', async () => {
    runMongoAction.mockResolvedValue({});
    const plaintext = 'AIzaSyPlaintextGeminiKey0001';
    await setProviderKey('userA', 'gemini', plaintext);

    expect(runMongoAction).toHaveBeenCalledTimes(1);
    const [action, payload] = runMongoAction.mock.calls[0];
    expect(action).toBe('updateOne');
    // Ownership is enforced server-side via the filter.
    expect(payload.filter).toEqual({ userId: 'userA', provider: 'gemini' });
    // The persisted ciphertext must not contain the plaintext key anywhere.
    const stored = JSON.stringify(payload.update);
    expect(stored).not.toContain(plaintext);
    expect(payload.update.$set.ciphertext.startsWith('v1.')).toBe(true);
    // Only a last-4 preview is stored alongside.
    expect(payload.update.$set.last4).toBe('…0001');
  });

  it('returns masked status with NO key material', async () => {
    runMongoAction.mockResolvedValue({
      documents: [{ provider: 'gemini', last4: '…abcd', updatedAt: '2026-01-01' }],
    });
    const status = await getProviderKeyStatus('userA');

    expect(status.gemini).toEqual({ configured: true, last4: '…abcd', updatedAt: '2026-01-01' });
    expect(status.openai).toEqual({ configured: false, last4: '', updatedAt: null });
    // Status must never carry ciphertext / raw key fields.
    const serialized = JSON.stringify(status);
    expect(serialized).not.toContain('ciphertext');
  });

  it('decrypts only the requested user\'s own key (AAD bound to userId:provider)', async () => {
    const plaintext = 'sk-openai-secret-key-xyz';
    const ciphertext = encryptSecret(plaintext, 'userA:openai');
    runMongoAction.mockResolvedValue({ document: { ciphertext } });

    const got = await getDecryptedProviderKey('userA', 'openai');
    expect(got).toBe(plaintext);

    // The filter pins the lookup to the caller's own userId.
    const [, payload] = runMongoAction.mock.calls[0];
    expect(payload.filter).toEqual({ userId: 'userA', provider: 'openai' });
  });

  it('fails to decrypt a key stored under a different user (no cross-user access)', async () => {
    // Ciphertext was bound to userB, but userA asks for it.
    const ciphertext = encryptSecret('sk-userB-key', 'userB:openai');
    runMongoAction.mockResolvedValue({ document: { ciphertext } });
    await expect(getDecryptedProviderKey('userA', 'openai')).rejects.toThrow();
  });

  it('validateProviderKey rejects empty/short/garbage keys', () => {
    expect(validateProviderKey('').ok).toBe(false);
    expect(validateProviderKey('short').ok).toBe(false);
    expect(validateProviderKey('has spaces in it now').ok).toBe(false);
    expect(validateProviderKey('AIzaSyValidLookingKey123').ok).toBe(true);
  });
});
