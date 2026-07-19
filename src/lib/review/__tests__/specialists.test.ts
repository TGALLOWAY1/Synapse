import { describe, expect, it } from 'vitest';
import { recommendSpecialistPanel } from '../specialists';
import { makeManifest } from './reviewTestUtils';

describe('recommended specialist panel', () => {
    it('selects a small relevant panel deterministically', () => {
        const first = recommendSpecialistPanel(makeManifest());
        const second = recommendSpecialistPanel(makeManifest());
        expect(first).toEqual(second);
        expect(first.length).toBeGreaterThanOrEqual(3);
        expect(first.length).toBeLessThanOrEqual(5);
        expect(first.map(item => item.specialistId)).toContain('ai_model_risk');
        expect(first.map(item => item.specialistId)).toContain('security_privacy');
        expect(first.every(item => item.reasons.length > 0)).toBe(true);
    });

    it('lets a focus note influence selection without requiring agent configuration', () => {
        const panel = recommendSpecialistPanel(makeManifest(), { focus: 'keyboard accessibility', max: 5 });
        expect(panel.map(item => item.specialistId)).toContain('accessibility');
    });
});
