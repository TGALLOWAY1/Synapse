import { describe, expect, it } from 'vitest';
import {
    FALLBACK_DESIGN_PRESET_ID,
    recommendDesignSystemPreset,
    recommendDesignSystemPresetId,
} from '../designPresetRecommendation';
import { getDesignSystemPreset } from '../designSystemPresets';

describe('recommendDesignSystemPreset', () => {
    it('maps music / creator / media ideas to Creative Studio', () => {
        expect(recommendDesignSystemPresetId(
            'A DJ app for building playlists and mixing music with friends',
        )).toBe('creative_studio');
        expect(recommendDesignSystemPresetId(
            'A portfolio site builder for photography artists',
        )).toBe('creative_studio');
    });

    it('maps CRM / finance / enterprise ideas to Enterprise Professional', () => {
        expect(recommendDesignSystemPresetId(
            'A CRM for tracking sales pipelines and invoicing',
        )).toBe('enterprise_professional');
        expect(recommendDesignSystemPresetId(
            'An internal tool for HR payroll and compliance reporting',
        )).toBe('enterprise_professional');
    });

    it('maps habit / wellness / lifestyle ideas to Consumer Mobile', () => {
        expect(recommendDesignSystemPresetId(
            'A habit tracker with meditation and sleep goals',
        )).toBe('consumer_mobile');
        expect(recommendDesignSystemPresetId(
            'A mobile recipe and meal planning app for consumers',
        )).toBe('consumer_mobile');
    });

    it('maps developer / API / technical ideas to Developer / Technical', () => {
        expect(recommendDesignSystemPresetId(
            'An API workbench with a CLI for testing developer SDKs',
        )).toBe('developer_tool');
        expect(recommendDesignSystemPresetId(
            'An observability dashboard for monitoring infrastructure',
        )).toBe('developer_tool');
    });

    it('maps notes / research / learning ideas to Minimal Editorial', () => {
        expect(recommendDesignSystemPresetId(
            'A note-taking app for research and study with flashcards',
        )).toBe('editorial_learning');
        expect(recommendDesignSystemPresetId(
            'A knowledge base for writing and reading documentation',
        )).toBe('editorial_learning');
    });

    it('falls back to Modern SaaS when nothing matches', () => {
        expect(recommendDesignSystemPresetId(
            'A tool that helps teams get things done together',
        )).toBe(FALLBACK_DESIGN_PRESET_ID);
        expect(recommendDesignSystemPresetId('')).toBe(FALLBACK_DESIGN_PRESET_ID);
        expect(recommendDesignSystemPresetId('   ')).toBe(FALLBACK_DESIGN_PRESET_ID);
    });

    it('scores by distinct keyword count so the dominant theme wins', () => {
        // One developer word vs several creative words.
        const { presetId, matchedTerms } = recommendDesignSystemPreset(
            'A music studio app for artists to publish songs, with an API',
        );
        expect(presetId).toBe('creative_studio');
        expect(matchedTerms).toContain('music');
        expect(matchedTerms.length).toBeGreaterThan(1);
    });

    it('matches whole words only', () => {
        // "smart" must not trigger the creative "art" keyword.
        expect(recommendDesignSystemPresetId('A smart scheduling assistant'))
            .toBe(FALLBACK_DESIGN_PRESET_ID);
    });

    it('always returns a real preset id', () => {
        for (const text of ['', 'music app', 'crm', 'random words here']) {
            const id = recommendDesignSystemPresetId(text);
            expect(getDesignSystemPreset(id), text).toBeDefined();
        }
    });
});
