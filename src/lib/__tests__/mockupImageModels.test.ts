import { describe, it, expect } from 'vitest';
import {
    DEFAULT_MOCKUP_IMAGE_MODEL_PREFS,
    MOCKUP_IMAGE_MODELS,
    describeImageProviderChain,
    imageLatencyHint,
    imageModelLabel,
    imageProviderForModel,
    resolveImageProviderChain,
} from '../mockupImageModels';
import type { MockupImageProvider } from '../../types';

const all = () => true;
const only = (...providers: MockupImageProvider[]) => (p: MockupImageProvider) => providers.includes(p);

describe('mockup image model registry', () => {
    it('pins the provider slots to GPT Image 2 and Nano Banana 2.1', () => {
        expect(MOCKUP_IMAGE_MODELS.openai.modelId).toBe('gpt-image-2');
        expect(MOCKUP_IMAGE_MODELS.gemini.modelId).toBe('gemini-nano-banana-2.1');
        expect(DEFAULT_MOCKUP_IMAGE_MODEL_PREFS).toEqual({ primary: 'openai', fallback: 'gemini' });
    });
});

describe('resolveImageProviderChain', () => {
    it('orders primary before fallback', () => {
        expect(resolveImageProviderChain({ primary: 'openai', fallback: 'gemini' }, all)).toEqual(['openai', 'gemini']);
        expect(resolveImageProviderChain({ primary: 'gemini', fallback: 'openai' }, all)).toEqual(['gemini', 'openai']);
    });

    it('drops providers without a key, promoting the fallback', () => {
        expect(resolveImageProviderChain({ primary: 'openai', fallback: 'gemini' }, only('gemini'))).toEqual(['gemini']);
        expect(resolveImageProviderChain({ primary: 'openai', fallback: 'gemini' }, only())).toEqual([]);
    });

    it('never adds a fallback that is off or equal to the primary', () => {
        expect(resolveImageProviderChain({ primary: 'gemini', fallback: null }, all)).toEqual(['gemini']);
        expect(resolveImageProviderChain({ primary: 'gemini', fallback: 'gemini' }, all)).toEqual(['gemini']);
    });
});

describe('labels and copy', () => {
    it('labels known model ids, keeps unknown ids verbatim, and treats a missing id as the slot default', () => {
        expect(imageModelLabel('gemini-nano-banana-2.1')).toBe('Nano Banana 2.1');
        expect(imageModelLabel('gpt-image-2')).toBe('GPT Image 2');
        expect(imageModelLabel('gemini-nano-banana-3')).toBe('gemini-nano-banana-3');
        // Pre-provider renders carry no model: they were gpt-image-2…
        expect(imageModelLabel(undefined)).toBe('GPT Image 2');
        // …unless the key says otherwise (meta-less Gemini sync ref).
        expect(imageModelLabel(undefined, 'gemini')).toBe('Nano Banana 2.1');
    });

    it('maps a stored model id back to its provider', () => {
        expect(imageProviderForModel('gemini-nano-banana-2.1')).toBe('gemini');
        expect(imageProviderForModel('gemini-nano-banana-3')).toBe('gemini');
        expect(imageProviderForModel('gpt-image-2')).toBe('openai');
        expect(imageProviderForModel(undefined)).toBe('openai');
    });

    it('describes the routing a default generation will use', () => {
        expect(describeImageProviderChain([])).toBe('');
        expect(describeImageProviderChain(['gemini'])).toBe('Nano Banana 2.1');
        expect(describeImageProviderChain(['openai', 'gemini'])).toBe('GPT Image 2, falling back to Nano Banana 2.1');
    });

    it('names the vendor, model and expected latency while rendering', () => {
        expect(imageLatencyHint('openai', 'low')).toBe('OpenAI GPT Image 2 · usually 5–15s');
        expect(imageLatencyHint('openai', 'high')).toBe('OpenAI GPT Image 2 · this may take 30–60s');
        expect(imageLatencyHint('gemini', 'high')).toBe('Google Nano Banana 2.1 · usually 20–40s');
    });
});
