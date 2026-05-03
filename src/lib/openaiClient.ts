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
// Retry connection-level failures with exponential backoff; HTTP errors,
// auth failures, and AbortError bypass retry and propagate immediately.
const MAX_FETCH_RETRIES = 3;
const RETRY_BASE_MS = 1000;

// gpt-image-2 high-quality p99 sits around 60s; 75s gives headroom without
// leaving doomed sockets open on cellular eating retry budget.
const REQUEST_TIMEOUT_MS = 75_000;

const sleepWithAbort = (ms: number, signal?: AbortSignal): Promise<void> =>
    new Promise((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => {
            clearTimeout(t);
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });

const fetchWithRetry = async (url: string, init: RequestInit): Promise<Response> => {
    const signal = init.signal as AbortSignal | undefined;
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_FETCH_RETRIES; attempt++) {
        try {
            return await fetch(url, init);
        } catch (e) {
            lastError = e;
            if (!isRetryableNetworkError(e) || attempt === MAX_FETCH_RETRIES) throw e;
            const delay = RETRY_BASE_MS * 2 ** attempt;
            console.warn(`[openai] fetch failed (${(e as Error).message}); retrying in ${delay}ms (attempt ${attempt + 2}/${MAX_FETCH_RETRIES + 1})`);
            await sleepWithAbort(delay, signal);
        }
    }
    throw lastError;
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

    // Combine the caller-cancel signal with a hard request timeout. We track
    // `timedOut` separately so the error path can distinguish "we gave up"
    // from "the user clicked Cancel" — both surface as AbortError otherwise.
    const composite = new AbortController();
    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
        timedOut = true;
        composite.abort();
    }, REQUEST_TIMEOUT_MS);
    const onCallerAbort = () => composite.abort();
    opts.signal?.addEventListener('abort', onCallerAbort, { once: true });
    if (opts.signal?.aborted) composite.abort();

    let response: Response;
    try {
        response = await fetchWithRetry(OPENAI_IMAGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: composite.signal,
        });
    } catch (err) {
        // Bubble user-cancellation untouched, but rewrap timeout-driven aborts
        // so the UI can show "took too long" instead of swallowing silently.
        if ((err as { name?: string })?.name === 'AbortError') {
            if (timedOut) {
                throw new Error(
                    `Image preview took longer than ${Math.round(REQUEST_TIMEOUT_MS / 1000)}s. The mockup itself rendered above — this is just the optional AI screenshot. Try again on Wi-Fi.`
                );
            }
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
    } finally {
        clearTimeout(timeoutHandle);
        opts.signal?.removeEventListener('abort', onCallerAbort);
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
