import { describe, it, expect, beforeEach } from 'vitest';
import {
    CORE_ARTIFACT_COMPLEXITY,
    selectArtifactModel,
} from '../coreArtifactService';
import { DEFAULT_GEMINI_MODEL, DEFAULT_STRONG_MODEL } from '../../geminiClient';
import type { CoreArtifactSubtype } from '../../../types';

const ALL_SUBTYPES: CoreArtifactSubtype[] = [
    'screen_inventory',
    'user_flows',
    'data_model',
    'component_inventory',
    'implementation_plan',
    'prompt_pack',
    'design_system',
];

describe('core artifact complexity routing', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('tags every core artifact subtype with a complexity tier', () => {
        for (const subtype of ALL_SUBTYPES) {
            expect(CORE_ARTIFACT_COMPLEXITY[subtype]).toMatch(/^(low|high)$/);
        }
    });

    it('routes high-complexity artifacts to the Expert (strong) model', () => {
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-flash-test');
        localStorage.setItem('GEMINI_STRONG_MODEL', 'gemini-pro-test');

        const high: CoreArtifactSubtype[] = [
            'screen_inventory',
            'user_flows',
            'data_model',
            'implementation_plan',
        ];
        for (const subtype of high) {
            expect(CORE_ARTIFACT_COMPLEXITY[subtype]).toBe('high');
            expect(selectArtifactModel(subtype)).toBe('gemini-pro-test');
        }
    });

    it('routes low-complexity artifacts to the Fast (flash) model', () => {
        localStorage.setItem('GEMINI_FAST_MODEL', 'gemini-flash-test');
        localStorage.setItem('GEMINI_STRONG_MODEL', 'gemini-pro-test');

        const low: CoreArtifactSubtype[] = [
            'component_inventory',
            'design_system',
            'prompt_pack',
        ];
        for (const subtype of low) {
            expect(CORE_ARTIFACT_COMPLEXITY[subtype]).toBe('low');
            expect(selectArtifactModel(subtype)).toBe('gemini-flash-test');
        }
    });

    it('falls back to the per-tier defaults when tier models are unset', () => {
        // No GEMINI_FAST_MODEL / GEMINI_STRONG_MODEL and no GEMINI_MODEL → each
        // tier's default. Low → Flash default; high → the Pro (strong) default,
        // which must NOT collapse to Flash (that was the "Pro never used" bug).
        expect(selectArtifactModel('design_system')).toBe(DEFAULT_GEMINI_MODEL);
        expect(selectArtifactModel('implementation_plan')).toBe(DEFAULT_STRONG_MODEL);

        // With only the single model set, both tiers resolve to it.
        localStorage.setItem('GEMINI_MODEL', 'gemini-single-test');
        expect(selectArtifactModel('design_system')).toBe('gemini-single-test');
        expect(selectArtifactModel('implementation_plan')).toBe('gemini-single-test');
    });
});
