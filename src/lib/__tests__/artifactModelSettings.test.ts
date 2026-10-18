// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
    CORE_ARTIFACT_COMPLEXITY,
    getArtifactModel,
    getArtifactModelOverrides,
    setArtifactModelOverrides,
    getRecommendedArtifactModel,
    getMockupImageMode,
    setMockupImageMode,
    DEFAULT_MOCKUP_IMAGE_MODE,
    resolveMockupRender,
    getMockupImageModelPrefs,
    setMockupImageModelPrefs,
    getMockupImageProviderChain,
    hasAnyMockupImageKey,
    hasMockupImageModel,
} from '../artifactModelSettings';
import { DEFAULT_GEMINI_MODEL, DEFAULT_FAST_MODEL, DEFAULT_STRONG_MODEL } from '../geminiClient';
import { setImageProviderConfigured } from '../openaiClient';
import { clearGeminiKey } from '../geminiKeyVault';
import type { CoreArtifactSubtype } from '../../types';

describe('artifact model settings — persistence & defaults', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('defaults to the complexity recommendation when no override is set', () => {
        localStorage.setItem('GEMINI_FAST_MODEL', 'flash-x');
        localStorage.setItem('GEMINI_STRONG_MODEL', 'pro-x');

        // high → strong, low → fast
        expect(getRecommendedArtifactModel('data_model')).toBe('pro-x');
        expect(getArtifactModel('data_model')).toBe('pro-x');
        expect(getArtifactModel('design_system')).toBe('flash-x');
    });

    it('falls back through the tier resolvers to the per-tier defaults', () => {
        // Nothing set at all → each tier's own default: high artifacts get the
        // strong (Argon) default, low artifacts get the fast (Flash) default. The
        // strong default must NOT collapse to Flash, or Settings' advertised
        // "Argon for complex" would silently run on Flash.
        for (const subtype of Object.keys(CORE_ARTIFACT_COMPLEXITY) as CoreArtifactSubtype[]) {
            const expected = CORE_ARTIFACT_COMPLEXITY[subtype] === 'high'
                ? DEFAULT_STRONG_MODEL
                : DEFAULT_FAST_MODEL;
            expect(getArtifactModel(subtype)).toBe(expected);
        }
        expect(DEFAULT_FAST_MODEL).toBe(DEFAULT_GEMINI_MODEL);
        expect(DEFAULT_STRONG_MODEL).not.toBe(DEFAULT_GEMINI_MODEL);

        // With only the single Default model set, both tiers resolve to it.
        localStorage.setItem('GEMINI_MODEL', 'single-x');
        expect(getArtifactModel('data_model')).toBe('single-x');
        expect(getArtifactModel('prompt_pack')).toBe('single-x');
    });

    it('persists and reads back an explicit per-artifact override', () => {
        setArtifactModelOverrides({ design_system: 'pro-x', user_flows: 'flash-x' });

        const stored = getArtifactModelOverrides();
        expect(stored.design_system).toBe('pro-x');
        expect(stored.user_flows).toBe('flash-x');

        // Override wins over the complexity recommendation.
        localStorage.setItem('GEMINI_FAST_MODEL', 'flash-default');
        expect(getArtifactModel('design_system')).toBe('pro-x');
    });

    it('drops empty values and removes the key when the map is empty', () => {
        setArtifactModelOverrides({ data_model: 'pro-x' });
        expect(localStorage.getItem('GEMINI_ARTIFACT_MODELS')).not.toBeNull();

        setArtifactModelOverrides({});
        expect(localStorage.getItem('GEMINI_ARTIFACT_MODELS')).toBeNull();
        expect(getArtifactModelOverrides()).toEqual({});
    });

    it('ignores unknown subtypes and malformed JSON defensively', () => {
        localStorage.setItem('GEMINI_ARTIFACT_MODELS', '{ not json');
        expect(getArtifactModelOverrides()).toEqual({});

        localStorage.setItem(
            'GEMINI_ARTIFACT_MODELS',
            JSON.stringify({ bogus_subtype: 'x', data_model: 'pro-x' }),
        );
        const stored = getArtifactModelOverrides();
        expect(stored).toEqual({ data_model: 'pro-x' });
    });
});

describe('mockup image mode persistence', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to AI generation', () => {
        expect(getMockupImageMode()).toBe(DEFAULT_MOCKUP_IMAGE_MODE);
        expect(getMockupImageMode()).toBe('ai_generated');
    });

    it('persists a user_uploaded selection', () => {
        setMockupImageMode('user_uploaded');
        expect(getMockupImageMode()).toBe('user_uploaded');
    });

    it('reads the legacy gpt_image value as AI generation', () => {
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_MODE', 'gpt_image');
        expect(getMockupImageMode()).toBe('ai_generated');
    });

    it('falls back to the default for an invalid stored value', () => {
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_MODE', 'garbage');
        expect(getMockupImageMode()).toBe('ai_generated');
    });
});

describe('mockup image model prefs (primary / fallback)', () => {
    beforeEach(() => localStorage.clear());

    it('defaults to GPT Image 2 with Nano Banana 2.1 as the fallback', () => {
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'openai', fallback: 'gemini' });
    });

    it('persists a swapped primary and fallback', () => {
        setMockupImageModelPrefs({ primary: 'gemini', fallback: 'openai' });
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'gemini', fallback: 'openai' });
    });

    it('persists "no fallback" as an explicit choice', () => {
        setMockupImageModelPrefs({ primary: 'gemini', fallback: null });
        expect(localStorage.getItem('SYNAPSE_MOCKUP_IMAGE_FALLBACK')).toBe('none');
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'gemini', fallback: null });
    });

    it('defaults an unset fallback to the other model, and never falls back to the primary itself', () => {
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_PRIMARY', 'gemini');
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'gemini', fallback: 'openai' });

        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_FALLBACK', 'gemini');
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'gemini', fallback: null });

        setMockupImageModelPrefs({ primary: 'openai', fallback: 'openai' });
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'openai', fallback: null });
    });

    it('ignores garbage stored values', () => {
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_PRIMARY', 'dall-e');
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_FALLBACK', 'midjourney');
        expect(getMockupImageModelPrefs()).toEqual({ primary: 'openai', fallback: 'gemini' });
    });
});

describe('mockup image provider chain — key availability', () => {
    beforeEach(() => {
        localStorage.clear();
        clearGeminiKey();
        setImageProviderConfigured(false);
    });

    it('is empty when neither model has a key', () => {
        expect(getMockupImageProviderChain()).toEqual([]);
        expect(hasMockupImageModel()).toBe(false);
        expect(hasAnyMockupImageKey()).toBe(false);
    });

    it('runs primary then fallback when both have keys', () => {
        setImageProviderConfigured(true);
        localStorage.setItem('GEMINI_API_KEY', 'local-key');
        expect(getMockupImageProviderChain()).toEqual(['openai', 'gemini']);

        setMockupImageModelPrefs({ primary: 'gemini', fallback: 'openai' });
        expect(getMockupImageProviderChain()).toEqual(['gemini', 'openai']);
    });

    it('skips a keyless primary so a Gemini-only user still gets Nano Banana', () => {
        localStorage.setItem('GEMINI_API_KEY', 'local-key');
        expect(getMockupImageProviderChain()).toEqual(['gemini']);
        expect(hasMockupImageModel()).toBe(true);
    });

    it('has no default route when the keyless primary has no fallback, but a keyed model stays pickable', () => {
        localStorage.setItem('GEMINI_API_KEY', 'local-key');
        setMockupImageModelPrefs({ primary: 'openai', fallback: null });
        expect(getMockupImageProviderChain()).toEqual([]);
        expect(hasMockupImageModel()).toBe(false);
        expect(hasAnyMockupImageKey()).toBe(true);
    });
});

describe('resolveMockupRender — image source routing', () => {
    it('uses the AI generator when AI generation is selected and a model has a key', () => {
        expect(resolveMockupRender('ai_generated', true)).toEqual({
            manual: false,
            forcedFallback: false,
        });
    });

    it('falls back to the manual sheet when AI generation is selected but no model has a key (no silent fail)', () => {
        expect(resolveMockupRender('ai_generated', false)).toEqual({
            manual: true,
            forcedFallback: true,
        });
    });

    it('always shows the manual sheet for User Uploaded, regardless of key', () => {
        expect(resolveMockupRender('user_uploaded', true)).toEqual({
            manual: true,
            forcedFallback: false,
        });
        expect(resolveMockupRender('user_uploaded', false)).toEqual({
            manual: true,
            forcedFallback: false,
        });
    });
});
