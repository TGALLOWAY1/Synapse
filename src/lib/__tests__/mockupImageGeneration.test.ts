import { describe, it, expect, beforeEach, vi } from 'vitest';

const { callOpenAIImage, callGeminiImage } = vi.hoisted(() => ({
    callOpenAIImage: vi.fn(),
    callGeminiImage: vi.fn(),
}));
vi.mock('../openaiClient', () => ({ callOpenAIImage }));
vi.mock('../geminiClient', () => ({ callGeminiImage }));

import {
    NO_IMAGE_MODEL_MESSAGE,
    generateMockupImageWithFallback,
    renderMockupImage,
} from '../mockupImageGeneration';
import type { MockupImageProvider } from '../../types';

const buildPrompt = (p: MockupImageProvider) => `prompt for ${p}`;

const run = (chain: MockupImageProvider[], extra: Partial<Parameters<typeof generateMockupImageWithFallback>[0]> = {}) =>
    generateMockupImageWithFallback({
        chain,
        buildPrompt,
        quality: 'low',
        shape: { platform: 'mobile' },
        signal: new AbortController().signal,
        ...extra,
    });

beforeEach(() => {
    callOpenAIImage.mockReset().mockResolvedValue('T1BFTkFJ');
    callGeminiImage.mockReset().mockResolvedValue({ b64: 'R0VNSU5J', mimeType: 'image/jpeg' });
});

describe('renderMockupImage — per-provider request shape', () => {
    it('sends gpt-image-2 its size crop and wraps the PNG', async () => {
        const out = await renderMockupImage('openai', 'p', {
            quality: 'low', shape: { platform: 'mobile', viewport: 'desktop' }, signal: new AbortController().signal,
        });
        expect(callOpenAIImage).toHaveBeenCalledWith('p', expect.objectContaining({ quality: 'low', size: '1536x1024' }));
        expect(out).toEqual({ dataUrl: 'data:image/png;base64,T1BFTkFJ', model: 'gpt-image-2' });
    });

    it('sends Nano Banana its aspect ratio + resolution and keeps the returned MIME type', async () => {
        const out = await renderMockupImage('gemini', 'p', {
            quality: 'low', shape: { platform: 'mobile' }, signal: new AbortController().signal,
        });
        expect(callGeminiImage).toHaveBeenCalledWith('p', expect.objectContaining({
            model: 'gemini-nano-banana-2.1', aspectRatio: '9:16', imageSize: '1K',
        }));
        expect(callGeminiImage.mock.calls[0][1]).not.toHaveProperty('thinkingLevel');
        expect(out).toEqual({ dataUrl: 'data:image/jpeg;base64,R0VNSU5J', model: 'gemini-nano-banana-2.1' });
    });

    it('renders high quality on Nano Banana at 2K with extended thinking, and a tablet variant at 4:3', async () => {
        await renderMockupImage('gemini', 'p', {
            quality: 'high', shape: { platform: 'mobile', viewport: 'tablet' }, signal: new AbortController().signal,
        });
        expect(callGeminiImage).toHaveBeenCalledWith('p', expect.objectContaining({
            aspectRatio: '4:3', imageSize: '2K', thinkingLevel: 'HIGH',
        }));
    });
});

describe('generateMockupImageWithFallback', () => {
    it('renders on the first provider with that provider\'s own prompt', async () => {
        const out = await run(['gemini', 'openai']);
        expect(out).toEqual({
            provider: 'gemini',
            model: 'gemini-nano-banana-2.1',
            dataUrl: 'data:image/jpeg;base64,R0VNSU5J',
            prompt: 'prompt for gemini',
        });
        expect(callOpenAIImage).not.toHaveBeenCalled();
    });

    it('falls back to the next provider when the first fails, announcing the switch', async () => {
        callOpenAIImage.mockRejectedValue(new Error('OpenAI quota / rate limit hit.'));
        const onAttempt = vi.fn();
        const out = await run(['openai', 'gemini'], { onAttempt });

        expect(out.provider).toBe('gemini');
        expect(out.prompt).toBe('prompt for gemini');
        expect(onAttempt.mock.calls).toEqual([['openai', undefined], ['gemini', 'openai']]);
    });

    it('names each model\'s failure when every provider fails', async () => {
        callOpenAIImage.mockRejectedValue(new Error('quota'));
        callGeminiImage.mockRejectedValue(new Error('no free tier'));

        await expect(run(['openai', 'gemini'])).rejects.toThrow(
            'GPT Image 2 failed: quota · Fallback Nano Banana 2.1 failed: no free tier',
        );
    });

    it('surfaces the provider\'s own message when only one model was tried (explicit choice)', async () => {
        callGeminiImage.mockRejectedValue(new Error('Gemini declined to generate this image (finishReason: IMAGE_SAFETY).'));

        await expect(run(['gemini'])).rejects.toThrow('Gemini declined to generate this image (finishReason: IMAGE_SAFETY).');
        expect(callOpenAIImage).not.toHaveBeenCalled();
    });

    it('never starts the fallback after a user cancel', async () => {
        const controller = new AbortController();
        callOpenAIImage.mockImplementation(async () => {
            controller.abort();
            throw new DOMException('Aborted', 'AbortError');
        });

        await expect(run(['openai', 'gemini'], { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
        expect(callGeminiImage).not.toHaveBeenCalled();
    });

    it('explains how to enable images when no model is available', async () => {
        await expect(run([])).rejects.toThrow(NO_IMAGE_MODEL_MESSAGE);
    });
});
