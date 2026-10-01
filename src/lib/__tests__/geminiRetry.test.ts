// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    backoffDelayMs,
    callGemini,
    callGeminiStream,
    GeminiHttpError,
    isRetryableHttpStatus,
    isRetryableNetworkError,
    MAX_FETCH_RETRIES,
    MAX_RETRY_AFTER_MS,
    parseRetryAfterMs,
} from '../geminiClient';
import { clearAllTraces, getTracesSnapshot, setTraceCaptureEnabled } from '../trace/traceRecorder';

// Transport-level retry policy (geminiClient.fetchWithRetry): rate limits
// (429) and transient server failures (500/502/503/504) are retried with
// bounded exponential backoff + jitter, honoring Retry-After and the caller's
// abort signal. Every other 4xx is deterministic and never retried.

const okResponse = (text: string): Response =>
    new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
    });

const errorResponse = (status: number, message: string, headers: Record<string, string> = {}): Response =>
    new Response(JSON.stringify({ error: { code: status, message, status: 'UNAVAILABLE' } }), {
        status,
        headers: { 'Content-Type': 'application/json', ...headers },
    });

const sseResponse = (chunks: object[]): Response =>
    new Response(chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join(''), {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
    });

const streamCallbacks = () => ({
    onChunk: vi.fn(),
    onComplete: vi.fn(),
    onError: vi.fn(),
    onRestart: vi.fn(),
    onFinish: vi.fn(),
});

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('GEMINI_API_KEY', 'test-key');
    // Deterministic backoff: no jitter → exactly 1s, 2s, 4s.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('retry policy helpers', () => {
    it('retries only rate limits and transient server errors', () => {
        for (const status of [429, 500, 502, 503, 504]) expect(isRetryableHttpStatus(status)).toBe(true);
        for (const status of [400, 401, 403, 404, 409, 501]) expect(isRetryableHttpStatus(status)).toBe(false);
    });

    it('backs off exponentially (≈1s, 2s, 4s) with up to 50% jitter', () => {
        expect([0, 1, 2].map((a) => backoffDelayMs(a, () => 0))).toEqual([1000, 2000, 4000]);
        expect(backoffDelayMs(2, () => 1)).toBe(6000);
    });

    it('parses Retry-After as delta-seconds or an HTTP date', () => {
        expect(parseRetryAfterMs('2')).toBe(2000);
        expect(parseRetryAfterMs('1.5')).toBe(1500);
        const now = Date.parse('2026-10-01T00:00:00Z');
        expect(parseRetryAfterMs('Thu, 01 Oct 2026 00:00:05 GMT', now)).toBe(5000);
        expect(parseRetryAfterMs(null)).toBeNull();
        expect(parseRetryAfterMs('soon')).toBeNull();
    });
});

describe('callGemini transport retries', () => {
    it('retries a 429 after the backoff and resolves with the next success', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(errorResponse(429, 'Resource has been exhausted (e.g. check quota).'))
            .mockResolvedValueOnce(okResponse('hello'));
        vi.stubGlobal('fetch', fetchMock);

        const pending = callGemini('system', 'prompt');
        await vi.advanceTimersByTimeAsync(999);
        expect(fetchMock).toHaveBeenCalledTimes(1); // still waiting out the 1s backoff
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe('hello');
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('gives up after MAX_FETCH_RETRIES on a persistent 500 and reports the status', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async () => errorResponse(500, 'Internal error encountered.'));
        vi.stubGlobal('fetch', fetchMock);

        const pending = callGemini('system', 'prompt');
        const assertion = expect(pending).rejects.toThrow(
            'Gemini API Error: 500 - Internal error encountered. (after 3 retries)',
        );
        await vi.advanceTimersByTimeAsync(1000 + 2000 + 4000);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(MAX_FETCH_RETRIES + 1);
    });

    it('never retries a deterministic 400', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async () => errorResponse(400, 'Request contains an invalid argument.'));
        vi.stubGlobal('fetch', fetchMock);

        const error = await callGemini('system', 'prompt').catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GeminiHttpError);
        expect((error as GeminiHttpError).status).toBe(400);
        expect((error as Error).message).toBe('Gemini API Error: 400 - Request contains an invalid argument.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('rejects promptly with AbortError when the caller aborts during the backoff', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn(async () => errorResponse(503, 'The model is overloaded.'));
        vi.stubGlobal('fetch', fetchMock);
        const controller = new AbortController();

        const pending = callGemini('system', 'prompt', undefined, controller.signal);
        const assertion = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        await vi.advanceTimersByTimeAsync(10); // first attempt answered 503; now backing off
        expect(fetchMock).toHaveBeenCalledTimes(1);

        controller.abort();
        await vi.advanceTimersByTimeAsync(0);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(1); // no attempt after the cancel
    });

    it('honors a Retry-After header instead of the default backoff', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(errorResponse(429, 'Slow down.', { 'Retry-After': '3' }))
            .mockResolvedValueOnce(okResponse('after the wait'));
        vi.stubGlobal('fetch', fetchMock);

        const pending = callGemini('system', 'prompt');
        await vi.advanceTimersByTimeAsync(2999);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1);
        await expect(pending).resolves.toBe('after the wait');
    });

    it('does not wait out a Retry-After longer than the cap — the error surfaces', async () => {
        vi.useFakeTimers();
        const retryAfter = String(MAX_RETRY_AFTER_MS / 1000 + 1);
        const fetchMock = vi.fn(async () => errorResponse(429, 'Quota exceeded.', { 'Retry-After': retryAfter }));
        vi.stubGlobal('fetch', fetchMock);

        await expect(callGemini('system', 'prompt')).rejects.toThrow('Gemini API Error: 429 - Quota exceeded.');
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it('records the retries on the LLM trace', async () => {
        vi.useFakeTimers();
        setTraceCaptureEnabled(true);
        await clearAllTraces();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(errorResponse(503, 'Overloaded.'))
            .mockResolvedValueOnce(okResponse('traced'));
        vi.stubGlobal('fetch', fetchMock);

        const pending = callGemini('system', 'prompt');
        await vi.advanceTimersByTimeAsync(1000);
        await expect(pending).resolves.toBe('traced');

        const trace = getTracesSnapshot().at(-1);
        expect(trace?.status).toBe('success');
        expect(trace?.retryCount).toBe(1);
        expect(trace?.validation?.retryReason).toBe('HTTP 503');
        setTraceCaptureEnabled(false);
        await clearAllTraces();
    });
});

describe('callGemini error messages', () => {
    it('quotes the status and the first ~200 characters of a non-JSON error body', async () => {
        const body = `<html><body><h1>Forbidden</h1>${'x'.repeat(400)}</body></html>`;
        vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 403, statusText: 'Forbidden' })));

        const error = await callGemini('system', 'prompt').catch((e: unknown) => e as Error);
        expect(error).toBeInstanceOf(Error);
        const message = (error as Error).message;
        expect(message).toContain('Gemini API Error: 403 Forbidden');
        expect(message).toContain('<html><body><h1>Forbidden</h1>xxx');
        expect(message).not.toContain('Unknown error');
        // Bounded quote: ~200 characters of the body, not all of it.
        expect(message.length).toBeLessThan(body.length);
        expect(message).toContain('…');
    });

    it('says so when the error body is empty', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 404 })));
        await expect(callGemini('system', 'prompt')).rejects.toThrow('Gemini API Error: 404 - Empty response body');
    });

    it('names a blocked prompt instead of reporting a generic empty response', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(
            JSON.stringify({ promptFeedback: { blockReason: 'SAFETY' } }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
        )));
        await expect(callGemini('system', 'prompt')).rejects.toThrow(/safety filters/);
    });
});

describe('callGeminiStream transport retries and safety', () => {
    it('does not re-retry an exhausted HTTP failure whose body mentions a network error', async () => {
        vi.useFakeTimers();
        // A gateway page that happens to say "NetworkError" must not look like
        // a connection drop to the stream-level retry loop.
        const fetchMock = vi.fn(async () => new Response('<html>Upstream NetworkError: bad gateway</html>', { status: 502 }));
        vi.stubGlobal('fetch', fetchMock);
        const callbacks = streamCallbacks();

        const pending = callGeminiStream('system', 'prompt', callbacks);
        const assertion = expect(pending).rejects.toThrow(/502 - Unexpected response body: <html>Upstream NetworkError/);
        await vi.advanceTimersByTimeAsync(60_000);
        await assertion;
        expect(fetchMock).toHaveBeenCalledTimes(MAX_FETCH_RETRIES + 1);
        expect(isRetryableNetworkError(new GeminiHttpError(502, 'NetworkError'))).toBe(false);
        expect(callbacks.onRestart).not.toHaveBeenCalled();
    });

    it('retries a 503 before any content is delivered, without a stream restart', async () => {
        vi.useFakeTimers();
        const fetchMock = vi.fn()
            .mockResolvedValueOnce(errorResponse(503, 'Overloaded.'))
            .mockResolvedValueOnce(sseResponse([
                { candidates: [{ content: { parts: [{ text: 'hi' }] }, finishReason: 'STOP' }] },
            ]));
        vi.stubGlobal('fetch', fetchMock);
        const callbacks = streamCallbacks();

        const pending = callGeminiStream('system', 'prompt', callbacks);
        await vi.advanceTimersByTimeAsync(1000);
        await expect(pending).resolves.toBe('hi');
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(callbacks.onChunk).toHaveBeenCalledTimes(1);
        expect(callbacks.onRestart).not.toHaveBeenCalled();
        expect(callbacks.onError).not.toHaveBeenCalled();
    });

    it('fails a SAFETY-stopped stream with a safety error instead of completing it', async () => {
        const fetchMock = vi.fn(async () => sseResponse([
            { candidates: [{ content: { parts: [{ text: 'partial' }] } }] },
            { candidates: [{ finishReason: 'SAFETY' }] },
        ]));
        vi.stubGlobal('fetch', fetchMock);
        const callbacks = streamCallbacks();

        await expect(callGeminiStream('system', 'prompt', callbacks)).rejects.toThrow(/safety filters/);
        expect(callbacks.onError).toHaveBeenCalledTimes(1);
        expect(callbacks.onComplete).not.toHaveBeenCalled();
        expect(fetchMock).toHaveBeenCalledTimes(1); // a refusal is never retried
    });
});
