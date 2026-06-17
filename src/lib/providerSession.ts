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
