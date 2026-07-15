import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { StructuredPRD } from '../../types';

const prd: StructuredPRD = {
    vision: 'A calm planning tool',
    targetUsers: ['Founders'],
    coreProblem: 'Plans hide unresolved choices',
    features: [],
    architecture: 'Local-first',
    risks: [],
    assumptions: [{
        id: 'a1', statement: 'Users want guest access', confidence: 'med',
        whyItMatters: 'If this is wrong, onboarding and account recovery must change.',
    }],
};

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({ planningRecords: {} });
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('planning record decision actions', () => {
    it('imports assumptions idempotently and records user verdicts as events', () => {
        const first = useProjectStore.getState().importPlanningAssumptions('p1', 's1', prd);
        const second = useProjectStore.getState().importPlanningAssumptions('p1', 's2', prd);
        expect(first).toEqual({ imported: 1, existing: 0 });
        expect(second).toEqual({ imported: 0, existing: 1 });

        const record = useProjectStore.getState().planningRecords.p1[0];
        expect(record.whyItMatters).toBe('If this is wrong, onboarding and account recovery must change.');
        useProjectStore.getState().updatePlanningRecordStatusByUser('p1', record.id, 'confirmed', {
            resolution: 'Allow a limited guest session',
            rationale: 'Reduce onboarding friction',
        });
        const confirmed = useProjectStore.getState().planningRecords.p1[0];
        expect(confirmed).toMatchObject({
            status: 'confirmed',
            resolution: 'Allow a limited guest session',
            rationale: 'Reduce onboarding friction',
        });
        expect(confirmed.events?.at(-1)).toMatchObject({ type: 'custom_answered', actor: 'user' });
    });

    it('rejects a model-authored verdict without mutating state', () => {
        useProjectStore.getState().importPlanningAssumptions('p1', 's1', prd);
        const record = useProjectStore.getState().planningRecords.p1[0];
        const before = useProjectStore.getState().planningRecords.p1;
        const result = useProjectStore.getState().appendPlanningDecisionEvent('p1', record.id, {
            id: 'unsafe', planningRecordId: record.id, type: 'custom_answered', actor: 'synapse',
            answer: 'Require an account', at: 101,
        } as never);
        expect(result).toEqual({ ok: false, reason: 'Only a user may author a decision verdict.' });
        expect(useProjectStore.getState().planningRecords.p1).toBe(before);
    });

    it('stores assessments separately from user authority', () => {
        useProjectStore.getState().importPlanningAssumptions('p1', 's1', prd);
        const record = useProjectStore.getState().planningRecords.p1[0];
        useProjectStore.getState().addPlanningAssessment('p1', record.id, {
            id: 'assessment-1', projectId: 'p1', planningRecordId: record.id,
            sourceSpineVersionId: 's1', status: 'fresh', evidence: [], inferredAssumptions: [],
            possibleConflictRecordIds: [], createdAt: 100,
            recommendation: { summary: 'Allow a limited guest session', confidence: 'medium' },
        });
        const assessed = useProjectStore.getState().planningRecords.p1[0];
        expect(assessed.status).toBe('open');
        expect(assessed.assessments?.[0].recommendation?.summary).toContain('guest session');
        expect(assessed.events?.some(event => event.type === 'custom_answered')).toBe(false);
    });
});
