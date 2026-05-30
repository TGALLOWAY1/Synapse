import { describe, it, expect } from 'vitest';
import { inferPreviewType, deriveAccessibility } from '../inferPreview';
import type { ComponentItem } from '../../../../types';

function comp(overrides: Partial<ComponentItem>): ComponentItem {
    return { name: 'X', purpose: '', complexity: 'simple', ...overrides };
}

describe('inferPreviewType', () => {
    it('honors an explicit previewType', () => {
        expect(inferPreviewType(comp({ name: 'Anything', previewType: 'toggle' }))).toBe('toggle');
    });

    it('matches archetypes from the component name', () => {
        expect(inferPreviewType(comp({ name: 'SettingsAccordion' }))).toBe('accordion');
        expect(inferPreviewType(comp({ name: 'AddressSearchInput' }))).toBe('input');
        expect(inferPreviewType(comp({ name: 'ToggleSwitch' }))).toBe('toggle');
        expect(inferPreviewType(comp({ name: 'PrimaryButton' }))).toBe('button');
    });

    it('falls back to prop hints, then custom', () => {
        expect(inferPreviewType(comp({ name: 'Widget', props: [{ name: 'onToggle', type: 'function' }] }))).toBe('toggle');
        expect(inferPreviewType(comp({ name: 'Widget', props: [{ name: 'placeholder', type: 'string' }] }))).toBe('input');
        expect(inferPreviewType(comp({ name: 'Mystery' }))).toBe('custom');
    });
});

describe('deriveAccessibility', () => {
    it('returns authored data with reviewNeeded=false', () => {
        const a = deriveAccessibility(comp({ accessibility: { keyboard: true, aria: ['aria-label'] } }));
        expect(a.reviewNeeded).toBe(false);
        expect(a.keyboard).toBe(true);
        expect(a.aria).toEqual(['aria-label']);
    });

    it('derives a heuristic contract flagged for review when absent', () => {
        const a = deriveAccessibility(comp({ name: 'SettingsAccordion' }));
        expect(a.reviewNeeded).toBe(true);
        expect(a.keyboard).toBe(true);
        expect(a.aria).toContain('aria-expanded');
    });
});
