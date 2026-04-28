// OpenAI gpt-image-2 client. Mirrors the shape of geminiClient.ts: a thin
// fetch wrapper, key sourced from localStorage, friendly error messages on
// the common failure modes (missing key, 401, quota, moderation refusal).
//
// gpt-image-2 always returns base64 PNG in `data[0].b64_json` — no polling
// or response_format negotiation needed. Synchronous; cancel via AbortSignal.

import type { MockupImageQuality } from '../types';

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

    let response: Response;
    try {
        response = await fetch(OPENAI_IMAGE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: opts.signal,
        });
    } catch (err) {
        // Bubble user-cancellation untouched.
        if ((err as { name?: string })?.name === 'AbortError') throw err;
        // Browser-level fetch failures arrive as TypeError with messages like
        // Safari's "Load failed" or Chromium's "Failed to fetch". These don't
        // carry HTTP status; surface a diagnostic that points at the actual
        // suspects (network, content blocker, VPN/proxy, CORS extension).
        const raw = err instanceof Error ? err.message : String(err);
        if (/load failed|failed to fetch|networkerror/i.test(raw)) {
            throw new Error(
                `Could not reach api.openai.com. Common causes: no network, ad/content blocker, VPN or corporate proxy, or a CORS-blocking browser extension. Raw: ${raw}`
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
