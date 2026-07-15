import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssumptionValidationEvent, PlanningRecord } from '../../types';
import {
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../../lib/planning';
import { useProjectStore } from '../projectStore';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({ planningRecords: {}, spineVersions: {} });
});

const createAssumption = (): PlanningRecord => {
    const { planningRecordId } = useProjectStore.getState().createPlanningRecord('project-1', {
        type: 'assumption',
        status: 'open',
        title: 'Creators will pay',
        statement: 'Independent creators will pay $20 per month.',
        evidence: [],
        sourceFindingIds: [],
        createdBy: 'user',
    });
    return useProjectStore.getState().planningRecords['project-1'].find(item => item.id === planningRecordId)!;
};

describe('assumption validation store boundary', () => {
    it('persists and replays append-only validation authority', () => {
        let current = createAssumption();
        const plan = sealAssumptionValidationPlan({
            id: 'plan-1',
            question: 'Will creators attempt checkout at $20?',
            method: { kind: 'prototype', label: 'Price-tested checkout prototype' },
            supportSignals: ['Checkout attempt'],
            contradictionSignals: ['Price abandonment'],
            inconclusiveConditions: ['Verbal interest without action'],
            limitations: ['Prototype purchase is not charged'],
            authoredBy: 'user',
            createdAt: 110,
        });
        const planResult = useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'plan-event', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 110,
                assumptionStatementHash: assumptionStatementHash(current), plan,
                expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
            }));
        expect(planResult).toEqual({ ok: true, duplicate: false });

        current = useProjectStore.getState().planningRecords['project-1'][0];
        const evidence = sealAssumptionEvidence({
            id: 'evidence-1', planningRecordId: current.id, sourceType: 'prototype', source: 'Prototype session 1',
            sourceIdentity: 'prototype-session-1', observedAt: 119, recordedAt: 120,
            observation: 'Participant attempted checkout after seeing the price.', validationQuestion: plan.question,
            limitations: ['No real charge'], character: 'direct', relation: 'supports',
            assumptionStatementHash: assumptionStatementHash(current), validationPlanHash: plan.contentHash,
            authoredBy: 'user',
        });
        const evidenceResult = useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'evidence-event', planningRecordId: current.id, actor: 'user', type: 'validation_evidence_recorded', at: 120,
                assumptionStatementHash: assumptionStatementHash(current), evidence,
                expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
            }));
        expect(evidenceResult).toEqual({ ok: true, duplicate: false });

        current = useProjectStore.getState().planningRecords['project-1'][0];
        const restored = JSON.parse(JSON.stringify(current)) as PlanningRecord;
        expect(projectAssumptionValidation(restored, 121)).toMatchObject({
            workflowState: 'in_progress',
            independentEvidence: [{ id: 'evidence-1' }],
        });
    });

    it('does not let generated creation data or a model-authored event acquire authority', () => {
        const unsafeEvent = {
            id: 'unsafe', planningRecordId: 'unknown', actor: 'user', type: 'validation_outcome_recorded', at: 1,
            assumptionStatementHash: 'unsafe', conclusion: 'supported', expectedValidationPlanHash: 'unsafe',
            expectedEvidenceSetHash: 'unsafe', integrityHash: 'unsafe',
        } as AssumptionValidationEvent;
        const { planningRecordId } = useProjectStore.getState().createPlanningRecord('project-1', {
            type: 'assumption', status: 'confirmed', title: 'Unsafe', statement: 'Unsafe', evidence: [],
            sourceFindingIds: [], createdBy: 'synapse',
            assumptionValidation: {
                schemaVersion: 1, events: [unsafeEvent], planProposals: [], interpretationProposals: [],
            },
        });
        const created = useProjectStore.getState().planningRecords['project-1'].find(item => item.id === planningRecordId)!;
        expect(created.assumptionValidation?.events).toEqual([]);
        expect(projectAssumptionValidation(created).acceptedConclusion).toBeUndefined();

        const userPlan = sealAssumptionValidationPlan({
            id: 'plan', question: 'Question?', method: { kind: 'other', label: 'Method' }, supportSignals: [],
            contradictionSignals: [], inconclusiveConditions: [], limitations: [], authoredBy: 'user', createdAt: 101,
        });
        const event = sealAssumptionValidationEvent({
            id: 'model-event', planningRecordId, actor: 'user', type: 'validation_plan_recorded', at: 101,
            assumptionStatementHash: assumptionStatementHash(created), plan: userPlan, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        });
        const modelEvent = { ...event, actor: 'synapse' } as unknown as AssumptionValidationEvent;
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', planningRecordId, modelEvent)).toMatchObject({
            ok: false,
        });
        expect(useProjectStore.getState().planningRecords['project-1'][0].assumptionValidation?.events).toEqual([]);
    });
});
