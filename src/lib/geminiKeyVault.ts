// Runtime Gemini key resolution.
//
// The Gemini streaming pipeline runs client-side (proxying a 60–90s SSE flow
// through serverless would hit duration limits), so the authenticated user's
// vault key is fetched into memory at call time and used directly. It is held
// only in this module variable for the session and is never written to
// localStorage. A legacy localStorage key remains a fallback for local dev /
// offline use. See docs/AUTH_AND_PROVIDER_KEYS.md for the security tradeoff.

import { getLocalCredential, GEMINI_API_KEY } from './localCredentials';

let cachedVaultKey: string | null = null;
let primed = false;
let inflight: Promise<void> | null = null;

/**
 * Fetch the user's Gemini key from the authenticated vault endpoint into
 * memory (once). Safe to call repeatedly — concurrent callers share one fetch,
 * and after the first success it's a no-op. Never throws: on any failure it
 * leaves the cache empty so callers fall back to a local key.
 */
export async function primeGeminiKey(force = false): Promise<void> {
  if (primed && !force) return;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const res = await fetch('/api/provider-keys?material=gemini', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json().catch(() => null);
        cachedVaultKey = typeof data?.key === 'string' && data.key.length > 0 ? data.key : null;
      } else {
        cachedVaultKey = null;
      }
    } catch {
      cachedVaultKey = null;
    } finally {
      primed = true;
      inflight = null;
    }
  })();
  return inflight;
}

/** The in-memory vault key, or null if not primed / not configured. */
export function getCachedGeminiKey(): string | null {
  return cachedVaultKey;
}

/**
 * True when a Gemini key is resolvable right now — the in-memory vault key OR
 * the legacy localStorage fallback. This mirrors the resolution order used by
 * the actual transport (`geminiClient.ts`), so pre-generation gates (e.g. the
 * HomePage submit/enhance buttons) agree with what generation will actually
 * use. A vault-only user (key in the encrypted server vault, nothing in
 * localStorage) must NOT be treated as "no key" — checking localStorage alone
 * wrongly bounces them to Settings.
 */
export function hasGeminiKey(): boolean {
  if (cachedVaultKey) return true;
  return Boolean(getLocalCredential(GEMINI_API_KEY));
}

/** Clear the cached key (e.g. on logout). */
export function clearGeminiKey(): void {
  cachedVaultKey = null;
  primed = false;
}
