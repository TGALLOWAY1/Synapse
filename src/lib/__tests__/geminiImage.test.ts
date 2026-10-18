// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { callGeminiImage } from '../geminiClient';
import { clearGeminiKey } from '../geminiKeyVault';

// The request shape below (`generationConfig.imageConfig` + IMAGE-only
// modality) and the response shape (`inlineData` JPEG + `thoughtSignature`)
// were verified against the live gemini-nano-banana-2.1 endpoint.

const OPTS = { model: 'gemini-nano-banana-2.1', aspectRatio: '9:16', imageSize: '1K' };

const json = (body: unknown, init: ResponseInit = {}): Response =>
    new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
        ...init,
    });

const imageResponse = (parts: object[], finishReason = 'STOP'): Response =>
    json({ candidates: [{ finishReason, content: { role: 'model', parts } }] });

beforeEach(() => {
    localStorage.clear();
    clearGeminiKey();
    localStorage.setItem('GEMINI_API_KEY', 'test-key');
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

describe('callGeminiImage request', () => {
    it('posts an IMAGE-only generateContent request with imageConfig, the key and the billing project', async () => {
        localStorage.setItem('GEMINI_PROJECT_ID', 'my-billing-project');
        const fetchMock = vi.fn(async () => imageResponse([{ inlineData: { mimeType: 'image/jpeg', data: 'QUJD' } }]));
        vi.stubGlobal('fetch', fetchMock);

        await callGeminiImage('draw the login screen', OPTS);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-nano-banana-2.1:generateContent');
        const headers = init.headers as Record<string, string>;
        expect(headers['x-goog-api-key']).toBe('test-key');
        expect(headers['x-goog-user-project']).toBe('my-billing-project');
        expect(JSON.parse(init.body as string)).toEqual({
            contents: [{ role: 'user', parts: [{ text: 'draw the login screen' }] }],
            generationConfig: {
                responseModalities: ['IMAGE'],
                imageConfig: { aspectRatio: '9:16', imageSize: '1K' },
            },
        });
    });

    it('adds thinkingConfig only when a thinking level is requested', async () => {
        const fetchMock = vi.fn(async () => imageResponse([{ inlineData: { mimeType: 'image/png', data: 'QUJD' } }]));
        vi.stubGlobal('fetch', fetchMock);

        await callGeminiImage('p', { ...OPTS, imageSize: '2K', thinkingLevel: 'HIGH' });

        const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
        expect(JSON.parse(init.body as string).generationConfig).toEqual({
            responseModalities: ['IMAGE'],
            imageConfig: { aspectRatio: '9:16', imageSize: '2K' },
            thinkingConfig: { thinkingLevel: 'HIGH' },
        });
    });

    it('asks for a Gemini key in Settings when none is available', async () => {
        localStorage.clear();
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow(
            'Add a Gemini API key in Settings to generate mockup images.',
        );
        expect(fetchMock).not.toHaveBeenCalled();
    });
});

describe('callGeminiImage response', () => {
    it('returns the image bytes with the MIME type Gemini reports (JPEG for Nano Banana 2.1)', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => imageResponse([
            { inlineData: { mimeType: 'image/jpeg', data: 'SlBFRw==' }, thoughtSignature: 'sig' },
        ])));

        await expect(callGeminiImage('p', OPTS)).resolves.toEqual({ b64: 'SlBFRw==', mimeType: 'image/jpeg' });
    });

    it('skips interim thought images and reads snake_case inline_data', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => imageResponse([
            { thought: true, inlineData: { mimeType: 'image/png', data: 'VEhPVUdIVA==' } },
            { inline_data: { mime_type: 'image/png', data: 'RklOQUw=' } },
        ])));

        await expect(callGeminiImage('p', OPTS)).resolves.toEqual({ b64: 'RklOQUw=', mimeType: 'image/png' });
    });

    it('names a policy refusal instead of returning nothing', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ candidates: [{ finishReason: 'IMAGE_SAFETY', content: { parts: [] } }] })));

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow(/declined to generate this image \(finishReason: IMAGE_SAFETY\)/);
    });

    it('names a blocked prompt', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } })));

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow(/blocked this image request \(blockReason: PROHIBITED_CONTENT\)/);
    });

    it('quotes the text when the model answers with text instead of an image', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => imageResponse([{ text: 'I can only describe this screen.' }])));

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow('Gemini returned text instead of an image: "I can only describe this screen."');
    });

    it('explains a free-tier key (image models have no free tier) instead of "wait and retry"', async () => {
        // A Retry-After past the client's cap surfaces the 429 without retrying.
        vi.stubGlobal('fetch', vi.fn(async () => json(
            { error: { code: 429, status: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } },
            { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '3600' } },
        )));

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow(/Gemini image generation has no free tier/);
    });

    it('reports other HTTP errors with status and message', async () => {
        vi.stubGlobal('fetch', vi.fn(async () => json(
            { error: { code: 400, status: 'INVALID_ARGUMENT', message: 'Unsupported aspect ratio' } },
            { status: 400 },
        )));

        await expect(callGeminiImage('p', OPTS)).rejects.toThrow('Gemini image API error (400): Unsupported aspect ratio');
    });
});
