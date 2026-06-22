// Primes runtime provider-key state for the current session.
//
// After auth resolves (or a key is added/removed in Settings) we sync two
// pieces of in-memory state the AI clients depend on:
//   - the OpenAI "configured" flag that gates image-generation affordances
//     (the browser can't read the key itself — image gen is proxied), and
//   - the in-memory Gemini key used by the client-side streaming pipeline.

import { fetchProviderKeyStatus } from './providerKeysApi';
import { setImageProviderConfigured } from './openaiClient';
import { primeGeminiKey, clearGeminiKey } from './geminiKeyVault';

export async function primeProviderSession(): Promise<void> {
  try {
    const res = await fetchProviderKeyStatus();
    setImageProviderConfigured(res.status.openai.configured);
  } catch {
    setImageProviderConfigured(false);
  }
  await primeGeminiKey(true);
}

export function clearProviderSession(): void {
  setImageProviderConfigured(false);
  clearGeminiKey();
}

// localStorage keys holding credential material for the optional "local browser
// keys" fallback. These are NOT user-namespaced (unlike projects), so they are
// shared by anyone using the same browser profile. We wipe them on an explicit
// sign-out so a different account signing in afterward never inherits the
// previous user's keys. (The encrypted server vault is per-user and unaffected.)
const LOCAL_CREDENTIAL_KEYS = [
  'GEMINI_API_KEY',
  'OPENAI_API_KEY',
  'GITHUB_TOKEN',
];

/**
 * Remove local-browser credential material from this browser. Called on an
 * explicit logout only — not on passive "no session" resolution — so anonymous
 * page loads don't wipe a user's offline fallback keys.
 */
export function clearLocalProviderKeys(): void {
  try {
    for (const key of LOCAL_CREDENTIAL_KEYS) {
      localStorage.removeItem(key);
    }
  } catch {
    // localStorage unavailable (private mode, etc.) — nothing to clear.
  }
}
