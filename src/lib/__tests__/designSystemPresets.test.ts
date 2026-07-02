import { describe, expect, it } from 'vitest';
import {
    DESIGN_SYSTEM_PRESETS,
    getDesignSystemPreset,
    getDesignSystemPresetDirective,
    getDesignSystemPresetLabel,
} from '../designSystemPresets';

describe('design system presets', () => {
    it('exposes the expected presets including a custom option', () => {
        const ids = DESIGN_SYSTEM_PRESETS.map(p => p.id);
        expect(ids).toEqual([
            'saas_minimal',
            'enterprise_professional',
            'ai_workspace',
            'editorial_learning',
            'developer_tool',
            'consumer_mobile',
            'creative_studio',
            'custom',
        ]);
    });

    it('returns a non-empty steering directive for concrete presets', () => {
        const directive = getDesignSystemPresetDirective('saas_minimal');
        expect(directive.length).toBeGreaterThan(20);
        expect(directive).toMatch(/SaaS/i);
        expect(getDesignSystemPresetDirective('enterprise_professional')).toMatch(/enterprise/i);
        expect(getDesignSystemPresetDirective('creative_studio')).toMatch(/creative/i);
    });

    it('returns an empty directive for custom / unknown / missing ids (no steering)', () => {
        expect(getDesignSystemPresetDirective('custom')).toBe('');
        expect(getDesignSystemPresetDirective('does-not-exist')).toBe('');
        expect(getDesignSystemPresetDirective(undefined)).toBe('');
    });

    it('resolves preset metadata and labels', () => {
        expect(getDesignSystemPreset('ai_workspace')?.label).toBe('AI Workspace');
        expect(getDesignSystemPresetLabel('developer_tool')).toBe('Developer / Technical');
        expect(getDesignSystemPresetLabel('saas_minimal')).toBe('Modern SaaS');
        // Unknown id falls back to the raw id rather than throwing.
        expect(getDesignSystemPresetLabel('mystery')).toBe('mystery');
        expect(getDesignSystemPresetLabel(undefined)).toBeUndefined();
    });

    it('carries setup-step metadata (tone + preview tokens) on every concrete preset', () => {
        for (const preset of DESIGN_SYSTEM_PRESETS) {
            if (preset.id === 'custom') {
                expect(preset.previewTokens).toBeUndefined();
                continue;
            }
            expect(preset.tone, preset.id).toBeTruthy();
            expect(preset.recommendedUseCases?.length, preset.id).toBeGreaterThan(0);
            expect(preset.visualTraits?.length, preset.id).toBeGreaterThan(0);
            const tokens = preset.previewTokens;
            expect(tokens, preset.id).toBeDefined();
            expect(tokens!.primary).toMatch(/^#/);
            expect(tokens!.background).toMatch(/^#/);
            expect(tokens!.radius).toBeGreaterThanOrEqual(0);
            expect(tokens!.fontFamily.length).toBeGreaterThan(0);
        }
    });
});
