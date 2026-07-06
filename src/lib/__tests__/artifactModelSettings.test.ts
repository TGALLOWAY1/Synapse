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
} from '../artifactModelSettings';
import { DEFAULT_GEMINI_MODEL, DEFAULT_FAST_MODEL, DEFAULT_STRONG_MODEL } from '../geminiClient';
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
        // strong (Pro) default, low artifacts get the fast (Flash) default. The
        // strong default must NOT collapse to Flash, or Settings' advertised
        // "Pro for complex" would silently run on Flash.
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

    it('defaults to gpt_image', () => {
        expect(getMockupImageMode()).toBe(DEFAULT_MOCKUP_IMAGE_MODE);
        expect(getMockupImageMode()).toBe('gpt_image');
    });

    it('persists a user_uploaded selection', () => {
        setMockupImageMode('user_uploaded');
        expect(getMockupImageMode()).toBe('user_uploaded');
    });

    it('falls back to the default for an invalid stored value', () => {
        localStorage.setItem('SYNAPSE_MOCKUP_IMAGE_MODE', 'garbage');
        expect(getMockupImageMode()).toBe('gpt_image');
    });
});

describe('resolveMockupRender — image source routing', () => {
    it('uses the OpenAI generator when GPT Image 2 is selected and a key exists', () => {
        expect(resolveMockupRender('gpt_image', true)).toEqual({
            manual: false,
            forcedFallback: false,
        });
    });

    it('falls back to the manual sheet when GPT Image 2 is selected but no key (no silent fail)', () => {
        expect(resolveMockupRender('gpt_image', false)).toEqual({
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
