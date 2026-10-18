// Runs one mockup render through the image-provider chain (see
// mockupImageModels.ts for the routing rules). Each attempt builds its own
// provider's prompt, calls that provider, and — on any failure other than a
// user cancel — moves on to the next provider. Shared by the screen image
// store and the per-variant store so both fall back identically.

import type { MockupImageProvider, MockupImageQuality } from '../types';
import { callGeminiImage } from './geminiClient';
import { callOpenAIImage } from './openaiClient';
import { MOCKUP_IMAGE_MODELS } from './mockupImageModels';
import {
    pickGeminiAspectRatio,
    pickGeminiImageConfig,
    pickOpenAIImageSize,
    type MockupImageShape,
} from './services/mockupImageService';

export const NO_IMAGE_MODEL_MESSAGE =
    'Add an OpenAI or Gemini API key in Settings to generate mockup images.';

export interface MockupImageRender {
    provider: MockupImageProvider;
    /** Exact model id that produced the image. */
    model: string;
    dataUrl: string;
    /** The prompt actually sent (it differs per provider). */
    prompt: string;
}

interface RenderOptions {
    quality: MockupImageQuality;
    shape: MockupImageShape;
    signal: AbortSignal;
}

/** One render on one provider, normalized to a data URL. */
export async function renderMockupImage(
    provider: MockupImageProvider,
    prompt: string,
    { quality, shape, signal }: RenderOptions,
): Promise<{ dataUrl: string; model: string }> {
    if (provider === 'gemini') {
        const model = MOCKUP_IMAGE_MODELS.gemini.modelId;
        const { b64, mimeType } = await callGeminiImage(prompt, {
            model,
            aspectRatio: pickGeminiAspectRatio(shape),
            ...pickGeminiImageConfig(quality),
            signal,
        });
        return { dataUrl: `data:${mimeType};base64,${b64}`, model };
    }
    const b64 = await callOpenAIImage(prompt, { quality, size: pickOpenAIImageSize(shape), signal });
    return { dataUrl: `data:image/png;base64,${b64}`, model: MOCKUP_IMAGE_MODELS.openai.modelId };
}

const isAbort = (err: unknown, signal: AbortSignal): boolean =>
    signal.aborted || (err as { name?: string })?.name === 'AbortError';

/**
 * Try `chain` in order until a provider returns an image. `onAttempt` fires
 * before each attempt (with the provider that just failed, for a fallback) so
 * the UI can say which model is running. A cancel rethrows the AbortError
 * untouched and never starts the next provider. When every provider fails the
 * error names each model's failure — or is the provider's own message when the
 * chain had only one model.
 */
export async function generateMockupImageWithFallback(args: RenderOptions & {
    chain: MockupImageProvider[];
    buildPrompt: (provider: MockupImageProvider) => string;
    onAttempt?: (provider: MockupImageProvider, fallbackFrom?: MockupImageProvider) => void;
}): Promise<MockupImageRender> {
    const { chain, buildPrompt, onAttempt, ...renderOptions } = args;
    if (chain.length === 0) throw new Error(NO_IMAGE_MODEL_MESSAGE);
    const failures: string[] = [];
    for (let i = 0; i < chain.length; i++) {
        const provider = chain[i];
        onAttempt?.(provider, i > 0 ? chain[i - 1] : undefined);
        const prompt = buildPrompt(provider);
        try {
            const { dataUrl, model } = await renderMockupImage(provider, prompt, renderOptions);
            return { provider, model, dataUrl, prompt };
        } catch (err) {
            if (isAbort(err, renderOptions.signal)) throw err;
            const label = MOCKUP_IMAGE_MODELS[provider].label;
            const message = err instanceof Error ? err.message : `${label} image generation failed.`;
            failures.push(chain.length === 1 ? message : `${i > 0 ? 'Fallback ' : ''}${label} failed: ${message}`);
        }
    }
    throw new Error(failures.join(' · '));
}
