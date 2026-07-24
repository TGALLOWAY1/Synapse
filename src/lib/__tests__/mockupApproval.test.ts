import { describe, expect, it } from 'vitest';
import type { MockupPayload, MockupScreen } from '../../types';
import {
    buildMockupScreenRecommendations,
    isMockupApproved,
    readMockupApproval,
    recommendedScreenIds,
} from '../mockupApproval';

const screen = (id: string, priority?: MockupScreen['priority']): MockupScreen => ({
    id,
    name: `Screen ${id}`,
    purpose: `Purpose ${id}`,
    priority,
});

const payload = (screens: MockupScreen[]): MockupPayload => ({
    version: 'mockup_spec_v1',
    title: 'Mockups',
    summary: 'Test payload',
    screens,
});

describe('readMockupApproval', () => {
    it('returns null when absent', () => {
        expect(readMockupApproval(undefined)).toBeNull();
        expect(readMockupApproval({})).toBeNull();
    });

    it('returns null when malformed', () => {
        expect(readMockupApproval({ mockupApproval: 'yes' })).toBeNull();
        expect(readMockupApproval({ mockupApproval: { approvedScreenIds: ['a'] } })).toBeNull();
        expect(readMockupApproval({ mockupApproval: { approvedAt: 1, approvedScreenIds: [1, 2] } })).toBeNull();
    });

    it('reads a valid overlay and defaults flowsReviewed to false', () => {
        const overlay = readMockupApproval({
            mockupApproval: { approvedAt: 100, approvedScreenIds: ['a', 'b'] },
        });
        expect(overlay).toEqual({ approvedAt: 100, approvedScreenIds: ['a', 'b'], flowsReviewed: false });
    });

    it('preserves flowsReviewed when true', () => {
        const overlay = readMockupApproval({
            mockupApproval: { approvedAt: 5, approvedScreenIds: [], flowsReviewed: true },
        });
        expect(overlay?.flowsReviewed).toBe(true);
    });
});

describe('isMockupApproved', () => {
    it('reflects overlay presence', () => {
        expect(isMockupApproved(undefined)).toBe(false);
        expect(isMockupApproved({ mockupApproval: { approvedAt: 1, approvedScreenIds: [] } })).toBe(true);
    });
});

describe('buildMockupScreenRecommendations', () => {
    it('recommends P0/P1 and unlabelled, defers P2/P3', () => {
        const recs = buildMockupScreenRecommendations(payload([
            screen('p0', 'P0'),
            screen('p1', 'P1'),
            screen('p2', 'P2'),
            screen('p3', 'P3'),
            screen('none'),
        ]));
        expect(recs.map(r => r.recommended)).toEqual([true, true, false, false, true]);
        expect(recs[0].reason).toContain('P0');
        expect(recs[4].reason).toBe('Recommended');
    });

    it('recommendedScreenIds returns only pre-checked ids', () => {
        expect(recommendedScreenIds(payload([
            screen('p0', 'P0'),
            screen('p2', 'P2'),
        ]))).toEqual(['p0']);
    });
});
