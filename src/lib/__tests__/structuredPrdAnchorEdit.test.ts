import { describe, expect, it } from 'vitest';
import { applyAnchorEditToStructuredPRD } from '../structuredPrdAnchorEdit';
import type { StructuredPRD } from '../../types';

const prd = (): StructuredPRD => ({
    vision: 'A calm habit tracker for busy parents.',
    targetUsers: ['Busy parents', 'Accountability partners'],
    coreProblem: 'Habit apps punish missed days.',
    features: [
        {
            id: 'f-streaks',
            name: 'Gentle streaks',
            description: 'Streaks pause instead of resetting when a day is missed.',
            userValue: 'No punishment for one bad day.',
            complexity: 'low',
            priority: 'must',
        },
    ],
    architecture: 'Local-first sync with a lightweight backend.',
    risks: ['Partners may expect real-time chat.'],
});

describe('applyAnchorEditToStructuredPRD', () => {
    it('replaces the anchor inside a top-level string field', () => {
        const result = applyAnchorEditToStructuredPRD(prd(), 'busy parents', 'working caregivers');
        expect(result.applied).toBe(true);
        if (result.applied) {
            expect(result.structuredPRD.vision).toBe('A calm habit tracker for working caregivers.');
        }
    });

    it('replaces the anchor inside nested objects and array items', () => {
        const inFeature = applyAnchorEditToStructuredPRD(prd(), 'pause instead of resetting', 'freeze for up to two days');
        expect(inFeature.applied).toBe(true);
        if (inFeature.applied) {
            expect(inFeature.structuredPRD.features[0].description).toContain('freeze for up to two days');
        }

        const inArray = applyAnchorEditToStructuredPRD(prd(), 'real-time chat', 'asynchronous notes');
        expect(inArray.applied).toBe(true);
        if (inArray.applied) {
            expect(inArray.structuredPRD.risks[0]).toBe('Partners may expect asynchronous notes.');
        }
    });

    it('replaces only the first occurrence and leaves the input untouched', () => {
        const source = prd();
        const result = applyAnchorEditToStructuredPRD(source, 'Busy parents', 'Working caregivers');
        expect(result.applied).toBe(true);
        if (result.applied) {
            expect(result.structuredPRD.targetUsers).toEqual(['Working caregivers', 'Accountability partners']);
        }
        // The original object is never mutated.
        expect(source.targetUsers[0]).toBe('Busy parents');
        expect(source.vision).toContain('busy parents');
    });

    it('never edits identifier fields', () => {
        const result = applyAnchorEditToStructuredPRD(prd(), 'f-streaks', 'renamed');
        expect(result.applied).toBe(false);
    });

    it('reports not-applied for a missing anchor or empty anchor', () => {
        expect(applyAnchorEditToStructuredPRD(prd(), 'text that is nowhere', 'x').applied).toBe(false);
        expect(applyAnchorEditToStructuredPRD(prd(), '', 'x').applied).toBe(false);
    });
});
