// OpenAI gpt-image-2 client. Mirrors the shape of geminiClient.ts: a thin
// fetch wrapper, key sourced from localStorage, friendly error messages on
// the common failure modes (missing key, 401, quota, moderation refusal).
//
// gpt-image-2 always returns base64 PNG in `data[0].b64_json` — no polling
// or response_format negotiation needed. Synchronous; cancel via AbortSignal.

import type { MockupImageQuality } from '../types';
import { isRetryableNetworkError } from './geminiClient';

// Image generation is proxied through our own backend so the OpenAI key (held
// encrypted in the server vault) is never exposed to the browser. The proxy
// decrypts the authenticated user's key server-side and forwards to OpenAI.
const IMAGE_PROXY_URL = '/api/image/generate';

export interface OpenAIImageOptions {
    size: string;                  // e.g. '1024x1024', '1024x1536', '1536x1024'
    quality: MockupImageQuality;   // 'low' | 'medium' | 'high'
    signal?: AbortSignal;
}

// Whether the authenticated user has an OpenAI key configured in the encrypted
// vault. Image generation can only run when this is true. The flag is primed
// from the provider-key status endpoint (see setImageProviderConfigured),
// because the browser can no longer read the key itself.
//
// Priming is async (primeProviderSession), so a component that reads this flag
// at first render may see `false` and then never re-render when priming lands —
// which left the high-quality / redo buttons stuck disabled on a fresh mobile
// load. We expose a subscription so React can re-render via useSyncExternalStore
// (see useHasOpenAIKey).
let imageProviderConfigured = false;
const keyListeners = new Set<() => void>();

/** Update the cached "OpenAI image key configured" flag from vault status. */
export const setImageProviderConfigured = (configured: boolean): void => {
    if (imageProviderConfigured === configured) return;
    imageProviderConfigured = configured;
    keyListeners.forEach((l) => l());
};

export const hasOpenAIKey = (): boolean => imageProviderConfigured;

/** Subscribe to changes in the OpenAI-key-configured flag. Returns an unsubscribe. */
export const subscribeOpenAIKey = (cb: () => void): (() => void) => {
    keyListeners.add(cb);
    return () => keyListeners.delete(cb);
};

/** Thrown when the user has no OpenAI key in the vault. */
const NO_KEY_MESSAGE = 'Add an OpenAI API key in Settings to generate mockups.';

// Mobile Safari surfaces transient connection drops as `TypeError: Load failed`
// during a single in-flight fetch. Image generation can take 20–60s, so a
// flaky cellular link kills the request before it ever reaches the server.
// Retry connection-level failures with exponential backoff; HTTP errors and
// auth failures bypass retry and propagate immediately.
const MAX_FETCH_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// gpt-image-2 high-quality p99 sits around 60s; 75s per attempt gives headroom
// without leaving doomed sockets open on cellular. This is a PER-ATTEMPT
// timeout, not a global budget: on mobile the common failure is a silently
// stalled socket (connection dies without throwing), and the only thing that
// fires is this timeout. We therefore treat a timed-out attempt as a
// retryable stall and reconnect on a fresh socket rather than dead-ending.
const ATTEMPT_TIMEOUT_MS = 75_000;

// A stall can recur, but waiting 4×75s on an *optional* screenshot is poor UX,
// so cap timeout-driven retries tighter than connection-error retries.
const MAX_TIMEOUT_RETRIES = 1;

// Thrown when every attempt timed out — lets callOpenAIImage surface the
// "took too long, try Wi-Fi" guidance instead of a generic network error.
class ImageRequestTimeoutError extends Error {
    constructor() {
        super('Image request timed out on every attempt.');
        this.name = 'ImageRequestTimeoutError';
    }
}

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });

// Each attempt gets its own AbortController + timeout, combined with the
// caller's cancel signal. A timed-out attempt aborts only this private
// controller (never the caller's signal), so the UI can still distinguish a
// timeout (banner shown) from a user cancel (silent). Timeouts and
// connection-level network errors are both retryable, on separate budgets.
const fetchWithRetry = async (
    url: string,
    init: RequestInit,
    callerSignal?: AbortSignal,
): Promise<Response> => {
    let timeoutRetries = 0;
    let networkRetries = 0;
    for (let attempt = 0; ; attempt++) {
        const attemptController = new AbortController();
        let attemptTimedOut = false;
        const timeoutHandle = setTimeout(() => {
            attemptTimedOut = true;
            attemptController.abort();
        }, ATTEMPT_TIMEOUT_MS);
        const onCallerAbort = () => attemptController.abort();
        callerSignal?.addEventListener('abort', onCallerAbort, { once: true });
        if (callerSignal?.aborted) attemptController.abort();

        try {
            return await fetch(url, { ...init, signal: attemptController.signal });
        } catch (e) {
            // Caller cancelled — propagate untouched, never retry.
            if (callerSignal?.aborted) throw e;

            const retryableNetwork = isRetryableNetworkError(e);
            const canRetry = attemptTimedOut
                ? timeoutRetries < MAX_TIMEOUT_RETRIES
                : retryableNetwork && networkRetries < MAX_FETCH_RETRIES;
            if (!canRetry) {
                if (attemptTimedOut) throw new ImageRequestTimeoutError();
                throw e;
            }
            if (attemptTimedOut) timeoutRetries++; else networkRetries++;

            const delay = RETRY_BASE_MS * 2 ** attempt;
            const reason = attemptTimedOut ? `timed out after ${ATTEMPT_TIMEOUT_MS}ms` : (e as Error).message;
            console.warn(`[openai] fetch failed (${reason}); retrying in ${delay}ms...`);
            await sleepWithAbort(delay, callerSignal);
        } finally {
            clearTimeout(timeoutHandle);
            callerSignal?.removeEventListener('abort', onCallerAbort);
        }
    }
};

const formatOpenAIError = (status: number, errorData: unknown): string => {
    const raw = (errorData as { error?: { message?: string; code?: string; type?: string } })?.error;
    const message = raw?.message || `HTTP ${status}`;
    const code = raw?.code || raw?.type || '';

    if (status === 401) {
        return 'OpenAI rejected the API key (401). Double-check the key in Settings.';
    }
    if (status === 429 || /rate.?limit|quota|insufficient.?quota/i.test(message)) {
        return `OpenAI quota / rate limit hit. Check your billing on platform.openai.com. Raw: ${message}`;
    }
    if (/moderation|safety|content.?policy/i.test(message) || code === 'moderation_blocked') {
        return `OpenAI refused to generate this image (content policy). Try a different prompt or PRD content. Raw: ${message}`;
    }
    return `OpenAI image API error (${status}): ${message}`;
};

/**
 * Call gpt-image-2 and return the raw base64 string (no `data:` prefix).
 * The caller is responsible for wrapping it as a data URL when stitching
 * into an <img src=...> or persisting it.
 */
export const callOpenAIImage = async (
    prompt: string,
    opts: OpenAIImageOptions,
): Promise<string> => {
    const startTime = performance.now();

    const body = {
        prompt,
        size: opts.size,
        quality: opts.quality,
    };

    // fetchWithRetry owns the per-attempt timeout and retry-on-stall logic;
    // we just pass the caller's cancel signal through and translate the
    // terminal failure modes into user-facing copy. The request goes to our
    // own backend proxy (same-origin, session cookie), which injects the
    // decrypted key — the browser never sees it.
    let response: Response;
    try {
        response = await fetchWithRetry(IMAGE_PROXY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(body),
        }, opts.signal);
    } catch (err) {
        // Every attempt timed out — surface "took too long" guidance rather
        // than swallowing it as a silent cancel.
        if (err instanceof ImageRequestTimeoutError) {
            throw new Error(
                `Image preview kept timing out after several attempts. The mockup itself rendered above — this is just the optional AI screenshot. Try again on Wi-Fi.`
            );
        }
        // User-initiated cancellation bubbles untouched (no error banner).
        if ((err as { name?: string })?.name === 'AbortError') {
            throw err;
        }
        // Browser-level fetch failures arrive as TypeError with messages like
        // Safari's "Load failed" or Chromium's "Failed to fetch". These don't
        // carry HTTP status. Be specific that this is the optional image
        // preview, not the (already-rendered) HTML mockup the user is staring
        // at — otherwise users read "mockup generation failed."
        const raw = err instanceof Error ? err.message : String(err);
        if (/load failed|failed to fetch|networkerror/i.test(raw)) {
            throw new Error(
                `Image preview couldn't reach OpenAI. The mockup itself rendered above — this is just the optional AI screenshot. Tap retry, or switch to Wi-Fi. Raw: ${raw}`
            );
        }
        throw new Error(`OpenAI image request failed before a response was received. Raw: ${raw}`);
    }

    if (!response.ok) {
        // 401 means the session expired; 400 with no_openai_key means the user
        // hasn't configured a key. Both get clear, actionable copy.
        if (response.status === 401) {
            throw new Error('Your session expired. Sign in again to generate images.');
        }
        const errorData = await response.json().catch(() => null);
        if (errorData?.error === 'no_openai_key') {
            throw new Error(errorData?.message || NO_KEY_MESSAGE);
        }
        // The proxy forwards a sanitized provider message (quota / moderation /
        // bad key). Reuse the existing OpenAI error copy, wrapping the flat
        // proxy shape back into what formatOpenAIError expects.
        throw new Error(
            formatOpenAIError(response.status, {
                error: { message: errorData?.message, code: errorData?.code },
            }),
        );
    }

    const data = await response.json();
    const b64: string | undefined = data?.b64;
    if (!b64) {
        throw new Error('OpenAI image API returned no image data. Please try again.');
    }

    const durationMs = performance.now() - startTime;
    console.log(
        `[GEN] callOpenAIImage(${opts.quality}, ${opts.size}): ${durationMs.toFixed(0)}ms (${b64.length} b64 chars)`,
    );
    return b64;
};
