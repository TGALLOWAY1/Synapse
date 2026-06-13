import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    callGemini,
    GeminiTimeoutError,
    GEMINI_TIMEOUT_MS,
    isRetryableNetworkError,
} from '../geminiClient';

/**
 * A fetch stub that never produces data: it resolves/rejects only when its
 * signal aborts — the hung-connection failure mode the watchdog exists for.
 */
const hangingFetch = (_url: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    new Promise((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
        }, { once: true });
    });

describe('gemini request watchdog', () => {
    beforeEach(() => {
        localStorage.clear();
        localStorage.setItem('GEMINI_API_KEY', 'test-key');
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.unstubAllGlobals();
    });

    it('classifies timeouts as retryable, unlike user aborts', () => {
        expect(isRetryableNetworkError(new GeminiTimeoutError(GEMINI_TIMEOUT_MS))).toBe(true);
        expect(isRetryableNetworkError(new DOMException('Aborted', 'AbortError'))).toBe(false);
    });

    it('rejects a hung callGemini with GeminiTimeoutError once the watchdog fires', async () => {
        vi.stubGlobal('fetch', hangingFetch);

        const pending = callGemini('system', 'prompt');
        // Attach the rejection expectation before advancing the clock so the
        // rejection is observed and not reported as unhandled.
        const assertion = expect(pending).rejects.toBeInstanceOf(GeminiTimeoutError);
        await vi.advanceTimersByTimeAsync(GEMINI_TIMEOUT_MS + 1);
        await assertion;
    });

    it('propagates a caller abort as AbortError, not a timeout', async () => {
        vi.stubGlobal('fetch', hangingFetch);

        const controller = new AbortController();
        const pending = callGemini('system', 'prompt', undefined, controller.signal);
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await vi.advanceTimersByTimeAsync(1);
        await assertion;
    });
});
