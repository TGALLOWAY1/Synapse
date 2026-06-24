import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { hasGeminiKey, primeGeminiKey, clearGeminiKey } from '../geminiKeyVault';

describe('hasGeminiKey', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    localStorage.clear();
    clearGeminiKey();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('is false when neither the vault nor a local key is present', () => {
    expect(hasGeminiKey()).toBe(false);
  });

  it('is true from the legacy localStorage fallback', () => {
    localStorage.setItem('GEMINI_API_KEY', 'local-key');
    expect(hasGeminiKey()).toBe(true);
  });

  it('is true when the vault key is primed in memory (no localStorage key)', async () => {
    // Regression: a vault-only user (key in the encrypted server vault, nothing
    // in localStorage) must be recognized as having a key, or the HomePage gate
    // wrongly routes them to Settings.
    global.fetch = (async () => ({
      ok: true,
      json: async () => ({ provider: 'gemini', key: 'vault-key' }),
    })) as unknown as typeof fetch;

    await primeGeminiKey(true);

    expect(localStorage.getItem('GEMINI_API_KEY')).toBeNull();
    expect(hasGeminiKey()).toBe(true);
  });
});
