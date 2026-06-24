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
import { clearLocalCredentialsForActiveUser } from './localCredentials';

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

/**
 * Remove local-browser credential material for the active user. Called on an
 * explicit logout only — not on passive "no session" resolution — so anonymous
 * page loads don't wipe a user's offline fallback keys. Local credential keys
 * are now namespaced per user (see localCredentials.ts), so this clears the
 * signing-out user's namespaced keys (and sweeps any legacy global copies).
 * The encrypted server vault is per-user server-side and unaffected.
 */
export function clearLocalProviderKeys(): void {
  clearLocalCredentialsForActiveUser();
}
