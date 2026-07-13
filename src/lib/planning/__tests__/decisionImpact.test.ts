import { describe, expect, it } from 'vitest';
import type { PlanningRecord, StructuredPRD } from '../../../types';
import { buildDecisionImpact, isDecisionImpactStale } from '../decisionImpact';

const prd: StructuredPRD = {
    vision: 'v', targetUsers: [], coreProblem: 'p', features: [], architecture: 'a', risks: [],
    assumptions: [{ id: 'a1', statement: 'Guests can start anonymously', confidence: 'med' }],
};

const record: PlanningRecord = {
    id: 'd1', projectId: 'p1', type: 'assumption', status: 'confirmed',
    title: 'Guest access', statement: 'Guests can start anonymously', evidence: [], sourceFindingIds: [],
    createdBy: 'migration', createdAt: 1, updatedAt: 2, confirmedAt: 2,
    sources: [{ key: 'prd_assumption:a1', sourceType: 'prd_assumption', sourceId: 'a1', sourceVersionId: 's1' }],
    events: [
        { id: 'import', planningRecordId: 'd1', type: 'imported', actor: 'migration', at: 1 },
        { id: 'verdict', planningRecordId: 'd1', type: 'custom_answered', actor: 'user', at: 2, answer: 'Allow a limited guest session' },
    ],
};

describe('decision impact preview', () => {
    it('builds a version-bound assumption patch without changing the input PRD', () => {
        const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        expect(result.ok).toBe(true);
        if (!result.ok) throw new Error(result.reason);
        if (!result.nextPrd) throw new Error('Expected an applicable PRD preview');
        expect(prd.assumptions?.[0].decision).toBeUndefined();
        expect(result.nextPrd.assumptions?.[0]).toMatchObject({
            decision: 'confirmed', decisionNote: 'Allow a limited guest session', decidedAt: 2,
        });
        expect(result.preview).toMatchObject({
            status: 'ready',
            baseline: { spineVersionId: 's1' },
            affectedPrdSections: ['Assumptions'],
        });
        expect(result.preview.affectedArtifactSlots).toContain('implementation_plan');
    });

    it('detects a changed spine or changed PRD content', () => {
        const result = buildDecisionImpact({ projectId: 'p1', record, baselineSpineVersionId: 's1', structuredPRD: prd, now: () => 10 });
        if (!result.ok) throw new Error(result.reason);
        expect(isDecisionImpactStale(result.preview, 's1', prd)).toBe(false);
        expect(isDecisionImpactStale(result.preview, 's2', prd)).toBe(true);
        expect(isDecisionImpactStale(result.preview, 's1', { ...prd, vision: 'changed' })).toBe(true);
    });

    it('refuses unresolved decisions and gives source-less decisions an advisory-only preview', () => {
        expect(buildDecisionImpact({ projectId: 'p1', record: { ...record, status: 'open', events: record.events?.slice(0, 1) }, baselineSpineVersionId: 's1', structuredPRD: prd }).ok).toBe(false);
        const advisory = buildDecisionImpact({ projectId: 'p1', record: { ...record, sources: [] }, baselineSpineVersionId: 's1', structuredPRD: prd });
        expect(advisory.ok).toBe(true);
        if (!advisory.ok) throw new Error(advisory.reason);
        expect(advisory.nextPrd).toBeUndefined();
        expect(advisory.preview.proposedPrdPatch).toBeUndefined();
        expect(advisory.preview.explanation).toContain('will not offer Apply to plan');
    });
});
