import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import type { PlanningRecord, StructuredPRD } from '../../types';
import {
    assumptionDefaultBatchCandidate,
    deferBatchCandidate,
    recommendationBatchCandidate,
} from '../../lib/planning/batchVerdicts';

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

const recommendedDecision = (): PlanningRecord => ({
    id: 'recommended-decision',
    projectId: 'p1',
    type: 'decision',
    status: 'open',
    title: 'Account model',
    statement: 'Choose an account model',
    decisionOptions: [
        { id: 'guest', label: 'Guest session' },
        { id: 'account', label: 'Account first' },
    ],
    recommendationDetail: {
        optionId: 'guest',
        summary: 'Guest session',
        rationale: 'Lower friction',
        confidence: 'medium',
    },
    decisionOptionsProvenance: {
        authoredBy: 'synapse',
        model: 'strong',
        generatedAt: 10,
    },
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 10,
});

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
        expect(first).toEqual({
            imported: 1,
            existing: 0,
            importedAssumptionIds: [useProjectStore.getState().planningRecords.p1[0].id],
        });
        expect(second).toEqual({
            imported: 0,
            existing: 1,
            importedAssumptionIds: [],
        });

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

    it('writes one guarded event and skips a changed recommendation', () => {
        useProjectStore.setState({
            planningRecords: { p1: [recommendedDecision()] },
        });
        const snapshot = useProjectStore.getState().planningRecords.p1[0];
        const candidate = recommendationBatchCandidate(snapshot)!;
        const saved = useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            snapshot.id,
            {
                id: 'answer',
                planningRecordId: snapshot.id,
                type: 'option_selected',
                actor: 'user',
                optionId: candidate.action === 'accept_recommendation'
                    ? candidate.optionId
                    : '',
                answer: candidate.action === 'accept_recommendation'
                    ? candidate.answer
                    : '',
                at: 100,
            },
            candidate,
        );
        expect(saved).toEqual({ ok: true, duplicate: false });

        const reopened = {
            ...snapshot,
            recommendationDetail: {
                ...snapshot.recommendationDetail!,
                summary: 'Changed recommendation',
            },
        };
        useProjectStore.setState({ planningRecords: { p1: [reopened] } });
        const before = useProjectStore.getState().planningRecords.p1;
        expect(useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            snapshot.id,
            {
                id: 'stale',
                planningRecordId: snapshot.id,
                type: 'option_selected',
                actor: 'user',
                optionId: candidate.action === 'accept_recommendation'
                    ? candidate.optionId
                    : '',
                answer: candidate.action === 'accept_recommendation'
                    ? candidate.answer
                    : '',
                at: 101,
            },
            candidate,
        )).toEqual({
            ok: false,
            code: 'stale_target',
            reason: 'The planning record changed before this verdict could be recorded.',
        });
        expect(useProjectStore.getState().planningRecords.p1).toBe(before);
    });

    it('rejects guarded events whose semantics do not match the frozen batch action', () => {
        useProjectStore.setState({
            planningRecords: { p1: [recommendedDecision()] },
        });
        const recommendationRecord = useProjectStore.getState().planningRecords.p1[0];
        const recommendation = recommendationBatchCandidate(recommendationRecord)!;
        const beforeRecommendation = useProjectStore.getState().planningRecords.p1;

        expect(useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            recommendationRecord.id,
            {
                id: 'wrong-recommendation-answer',
                planningRecordId: recommendationRecord.id,
                type: 'option_selected',
                actor: 'user',
                optionId: recommendation.optionId,
                answer: 'Account first',
                at: 100,
            },
            recommendation,
        )).toEqual({
            ok: false,
            code: 'stale_target',
            reason: 'The decision event did not match the guarded batch verdict.',
        });
        expect(useProjectStore.getState().planningRecords.p1).toBe(beforeRecommendation);

        useProjectStore.getState().importPlanningAssumptions('p1', 's1', prd);
        const assumption = useProjectStore.getState().planningRecords.p1
            .find(record => record.type === 'assumption')!;
        const defaultCandidate = assumptionDefaultBatchCandidate(assumption)!;
        const beforeDefault = useProjectStore.getState().planningRecords.p1;
        expect(useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            assumption.id,
            {
                id: 'wrong-default-answer',
                planningRecordId: assumption.id,
                type: 'custom_answered',
                actor: 'user',
                answer: 'A substituted answer',
                at: 100,
            },
            defaultCandidate,
        )).toEqual({
            ok: false,
            code: 'stale_target',
            reason: 'The decision event did not match the guarded batch verdict.',
        });
        expect(useProjectStore.getState().planningRecords.p1).toBe(beforeDefault);

        const deferCandidate = deferBatchCandidate(recommendationRecord)!;
        const beforeDefer = useProjectStore.getState().planningRecords.p1;
        expect(useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            recommendationRecord.id,
            {
                id: 'wrong-defer-event',
                planningRecordId: recommendationRecord.id,
                type: 'custom_answered',
                actor: 'user',
                answer: recommendationRecord.statement,
                at: 100,
            },
            deferCandidate,
        )).toEqual({
            ok: false,
            code: 'stale_target',
            reason: 'The decision event did not match the guarded batch verdict.',
        });
        expect(useProjectStore.getState().planningRecords.p1).toBe(beforeDefer);
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

    it('rejects remaining arrival-batch verdicts after the latest spine changes', () => {
        useProjectStore.getState().importPlanningAssumptions('p1', 's1', prd);
        const assumption = useProjectStore.getState().planningRecords.p1
            .find(record => record.type === 'assumption')!;
        const candidate = assumptionDefaultBatchCandidate(assumption, 's1')!;
        useProjectStore.setState({
            spineVersions: {
                p1: [
                    { id: 's1', projectId: 'p1', promptText: '', responseText: '', createdAt: 1, isLatest: false, isFinal: false },
                    { id: 's2', projectId: 'p1', promptText: '', responseText: '', createdAt: 2, isLatest: true, isFinal: false },
                ],
            },
        });
        const before = useProjectStore.getState().planningRecords.p1;

        expect(useProjectStore.getState().appendPlanningDecisionEvent(
            'p1',
            assumption.id,
            {
                id: 'old-arrival-default',
                planningRecordId: assumption.id,
                type: 'custom_answered',
                actor: 'user',
                answer: candidate.answer,
                at: 100,
            },
            candidate,
        )).toEqual({
            ok: false,
            code: 'stale_target',
            reason: 'The planning record changed before this verdict could be recorded.',
        });
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
