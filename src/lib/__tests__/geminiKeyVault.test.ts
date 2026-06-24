import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { hasGeminiKey, primeGeminiKey, clearGeminiKey } from '../geminiKeyVault';

describe('hasGeminiKey', () => {
  beforeEach(() => {
    localStorage.clear();
    clearGeminiKey();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
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
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ provider: 'gemini', key: 'vault-key' }),
    })));

    await primeGeminiKey(true);

    expect(localStorage.getItem('GEMINI_API_KEY')).toBeNull();
    expect(hasGeminiKey()).toBe(true);
  });
});
