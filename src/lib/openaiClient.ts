// OpenAI gpt-image-2 client. Mirrors the shape of geminiClient.ts: a thin
// fetch wrapper, key sourced from localStorage, friendly error messages on
// the common failure modes (missing key, 401, quota, moderation refusal).
//
// gpt-image-2 always returns base64 PNG in `data[0].b64_json` — no polling
// or response_format negotiation needed. Synchronous; cancel via AbortSignal.

import type { MockupImageQuality } from '../types';
import { isRetryableNetworkError } from './geminiClient';

const OPENAI_IMAGE_URL = 'https://api.openai.com/v1/images/generations';
const OPENAI_IMAGE_MODEL = 'gpt-image-2';

export interface OpenAIImageOptions {
    size: string;                  // e.g. '1024x1024', '1024x1536', '1536x1024'
    quality: MockupImageQuality;   // 'low' | 'medium' | 'high'
    signal?: AbortSignal;
}

const getOpenAIKey = (): string => {
    const key = localStorage.getItem('OPENAI_API_KEY');
    if (!key) {
        throw new Error(
            'Missing OpenAI API key. Open Settings (gear icon, top right) and add your OpenAI key under "OpenAI image preview".'
        );
    }
    return key;
};

export const hasOpenAIKey = (): boolean => {
    return !!localStorage.getItem('OPENAI_API_KEY')?.trim();
};

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
    const apiKey = getOpenAIKey();

    const body = {
        model: OPENAI_IMAGE_MODEL,
        prompt,
        size: opts.size,
        quality: opts.quality,
        n: 1,
    };

    // fetchWithRetry owns the per-attempt timeout and retry-on-stall logic;
    // we just pass the caller's cancel signal through and translate the
    // terminal failure modes into user-facing copy.
    let response: Response;
    try {
        response = await fetchWithRetry(OPENAI_IMAGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
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
        const errorData = await response.json().catch(() => null);
        throw new Error(formatOpenAIError(response.status, errorData));
    }

    const data = await response.json();
    const b64: string | undefined = data?.data?.[0]?.b64_json;
    if (!b64) {
        throw new Error('OpenAI image API returned no image data. Please try again.');
    }

    const durationMs = performance.now() - startTime;
    console.log(
        `[GEN] callOpenAIImage(${opts.quality}, ${opts.size}): ${durationMs.toFixed(0)}ms (${b64.length} b64 chars)`,
    );
    return b64;
};
