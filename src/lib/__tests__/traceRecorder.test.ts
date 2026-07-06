import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    beginTrace, isTraceCaptureEnabled, setTraceCaptureEnabled,
    getTracesSnapshot, subscribeTraces, clearAllTraces,
} from '../trace/traceRecorder';

describe('traceRecorder', () => {
    beforeEach(async () => {
        setTraceCaptureEnabled(false);
        await clearAllTraces();
    });

    it('returns a no-op handle (no capture) when disabled', () => {
        expect(isTraceCaptureEnabled()).toBe(false);
        const before = getTracesSnapshot().length;
        const h = beginTrace({ model: 'm', mode: 'json', systemInstruction: '', promptText: 'p', requestUrl: 'u', requestBody: {} });
        expect(h.id).toBeUndefined();
        h.finishSuccess({ rawResponse: 'r' });
        expect(getTracesSnapshot().length).toBe(before);
    });

    it('captures a call and notifies subscribers when enabled', () => {
        setTraceCaptureEnabled(true);
        const listener = vi.fn();
        const unsub = subscribeTraces(listener);

        const h = beginTrace({
            model: 'gemini-3.5-flash',
            mode: 'json',
            systemInstruction: 'sys',
            promptText: 'do the thing',
            requestUrl: 'https://x',
            requestBody: { model: 'gemini-3.5-flash' },
            meta: { stage: 'PRD', purpose: 'Test' },
        });
        expect(h.id).toBeDefined();
        h.finishSuccess({ rawResponse: '{"ok":true}', parsedJson: { ok: true }, finishReason: 'STOP' });

        const snap = getTracesSnapshot();
        const rec = snap.find((t) => t.id === h.id);
        expect(rec).toBeDefined();
        expect(rec?.meta.purpose).toBe('Test');
        expect(rec?.status).toBe('success');
        expect(rec?.rawResponse).toContain('ok');
        expect(listener).toHaveBeenCalled();
        unsub();
    });

    it('redacts secrets in the captured request body', () => {
        setTraceCaptureEnabled(true);
        const h = beginTrace({
            model: 'm', mode: 'json', systemInstruction: '', promptText: 'p',
            requestUrl: 'u',
            requestBody: { 'x-goog-api-key': 'AIzaSyLEAK000000000000000', prompt: 'p' },
        });
        h.finishSuccess({ rawResponse: 'ok' });
        const rec = getTracesSnapshot().find((t) => t.id === h.id);
        expect(rec?.requestBody).not.toContain('AIzaSyLEAK000000000000000');
    });

    it('records an error status on finishError', () => {
        setTraceCaptureEnabled(true);
        const h = beginTrace({ model: 'm', mode: 'stream', systemInstruction: '', promptText: 'p', requestUrl: 'u', requestBody: {} });
        h.finishError(new Error('boom'), { retryCount: 2 });
        const rec = getTracesSnapshot().find((t) => t.id === h.id);
        expect(rec?.status).toBe('error');
        expect(rec?.error).toBe('boom');
        expect(rec?.retryCount).toBe(2);
    });
});
