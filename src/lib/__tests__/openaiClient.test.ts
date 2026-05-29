import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { callOpenAIImage } from '../openaiClient';

// A fetch that never resolves on its own but rejects with AbortError the
// moment its signal is aborted — mirrors a real socket that has silently
// stalled (no bytes, no error) until our per-attempt timeout fires, and also
// the behaviour when the caller cancels.
const hangUntilAbort = (signal?: AbortSignal): Promise<Response> =>
    new Promise((_resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    });

const okImageResponse = (b64: string): Response =>
    ({ ok: true, json: async () => ({ data: [{ b64_json: b64 }] }) } as unknown as Response);

const ATTEMPT_TIMEOUT_MS = 75_000;
const opts = { quality: 'low' as const, size: '1024x1536' };

describe('callOpenAIImage timeout + retry', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        localStorage.setItem('OPENAI_API_KEY', 'test-key');
    });

    afterEach(() => {
        vi.useRealTimers();
        localStorage.clear();
        vi.restoreAllMocks();
    });

    it('retries a stalled attempt on a fresh connection instead of dead-ending', async () => {
        const fetchMock = vi.fn()
            // Attempt 1: stalls until our timeout aborts it.
            .mockImplementationOnce((_url, init: RequestInit) => hangUntilAbort(init.signal as AbortSignal))
            // Attempt 2 (fresh socket): succeeds.
            .mockImplementationOnce(async () => okImageResponse('IMG_B64'));
        vi.stubGlobal('fetch', fetchMock);

        const p = callOpenAIImage('prompt', opts);
        await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS); // attempt 1 times out
        await vi.advanceTimersByTimeAsync(1000);               // backoff before retry

        await expect(p).resolves.toBe('IMG_B64');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('surfaces the "try again on Wi-Fi" guidance once timeout retries are exhausted', async () => {
        const fetchMock = vi.fn((_url, init: RequestInit) => hangUntilAbort(init.signal as AbortSignal));
        vi.stubGlobal('fetch', fetchMock);

        const p = callOpenAIImage('prompt', opts);
        const assertion = expect(p).rejects.toThrow(/timing out after several attempts.*Try again on Wi-Fi/s);
        await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS); // attempt 1 times out
        await vi.advanceTimersByTimeAsync(1000);               // backoff
        await vi.advanceTimersByTimeAsync(ATTEMPT_TIMEOUT_MS); // attempt 2 (last) times out
        await assertion;

        // initial attempt + MAX_TIMEOUT_RETRIES (1) = 2 attempts, no more.
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('propagates a user cancel as AbortError without retrying', async () => {
        const fetchMock = vi.fn((_url, init: RequestInit) => hangUntilAbort(init.signal as AbortSignal));
        vi.stubGlobal('fetch', fetchMock);

        const controller = new AbortController();
        const p = callOpenAIImage('prompt', { ...opts, signal: controller.signal });
        const assertion = expect(p).rejects.toMatchObject({ name: 'AbortError' });
        controller.abort();
        await assertion;

        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
