import { describe, expect, it } from 'vitest';
import {
    DESIGN_SYSTEM_PRESETS,
    getDesignSystemPreset,
    getDesignSystemPresetDirective,
    getDesignSystemPresetLabel,
} from '../designSystemPresets';

describe('design system presets', () => {
    it('exposes the six expected presets including a custom option', () => {
        const ids = DESIGN_SYSTEM_PRESETS.map(p => p.id);
        expect(ids).toEqual([
            'saas_minimal',
            'ai_workspace',
            'editorial_learning',
            'developer_tool',
            'consumer_mobile',
            'custom',
        ]);
    });

    it('returns a non-empty steering directive for concrete presets', () => {
        const directive = getDesignSystemPresetDirective('saas_minimal');
        expect(directive.length).toBeGreaterThan(20);
        expect(directive).toMatch(/SaaS/i);
    });

    it('returns an empty directive for custom / unknown / missing ids (no steering)', () => {
        expect(getDesignSystemPresetDirective('custom')).toBe('');
        expect(getDesignSystemPresetDirective('does-not-exist')).toBe('');
        expect(getDesignSystemPresetDirective(undefined)).toBe('');
    });

    it('resolves preset metadata and labels', () => {
        expect(getDesignSystemPreset('ai_workspace')?.label).toBe('AI Workspace');
        expect(getDesignSystemPresetLabel('developer_tool')).toBe('Developer Tool');
        // Unknown id falls back to the raw id rather than throwing.
        expect(getDesignSystemPresetLabel('mystery')).toBe('mystery');
        expect(getDesignSystemPresetLabel(undefined)).toBeUndefined();
    });
});
