import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AssumptionValidationEvent, PlanningRecord } from '../../types';
import {
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    compareReadinessReviewCurrentness,
    deriveReadinessReview,
    projectAssumptionValidation,
    projectDecision,
    planningContentHash,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../../lib/planning';
import { useProjectStore } from '../projectStore';

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        planningRecords: {},
        spineVersions: { 'project-1': [{
            id: 'spine-1', projectId: 'project-1', promptText: 'Plan', responseText: 'Current plan',
            createdAt: 1, isLatest: true, isFinal: false,
        }] },
    });
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

    it('rejects same-id payload replacement before it can synthesize decision authority', () => {
        const current = createAssumption();
        const recordedPlan = sealAssumptionValidationPlan({
            id: 'plan', question: 'Will creators pay?', method: { kind: 'other', label: 'Exploratory test' },
            supportSignals: [], contradictionSignals: [], inconclusiveConditions: [], limitations: [],
            authoredBy: 'user', createdAt: 110,
        });
        const benign = sealAssumptionValidationEvent({
            id: 'reused-id', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 110,
            assumptionStatementHash: assumptionStatementHash(current), plan: recordedPlan,
            expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, benign)).toMatchObject({ ok: true });
        const forged = sealAssumptionValidationEvent({
            id: 'reused-id', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 110,
            assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported',
            expectedValidationPlanHash: recordedPlan.contentHash, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        });
        const modelForged = { ...forged, actor: 'synapse' } as unknown as AssumptionValidationEvent;
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, modelForged)).toMatchObject({
            ok: false, reason: 'Validation event id was already used for different content.',
        });
        const stored = useProjectStore.getState().planningRecords['project-1'][0];
        expect(stored.assumptionValidation?.events).toHaveLength(1);
        expect(stored.events?.some(event => event.id === 'assumption-validation-verdict-reused-id')).toBe(false);
    });

    it('atomically binds a contradicted outcome to the existing decision verdict used by impact review', () => {
        let current = createAssumption();
        const plan = sealAssumptionValidationPlan({
            id: 'technical-plan', question: 'Can the required browser workflow run?',
            method: { kind: 'technical_test', label: 'Browser spike' }, supportSignals: ['Workflow completes'],
            contradictionSignals: ['Browser security prevents the workflow'], inconclusiveConditions: [],
            limitations: ['Tested in current browser versions'], authoredBy: 'user', createdAt: 110,
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, sealAssumptionValidationEvent({
            id: 'technical-plan-event', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 110,
            assumptionStatementHash: assumptionStatementHash(current), plan, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const evidence = sealAssumptionEvidence({
            id: 'technical-evidence', planningRecordId: current.id, sourceType: 'technical_test', source: 'Browser spike',
            sourceIdentity: 'spike-run-1', observedAt: 119, recordedAt: 120,
            observation: 'The browser security model prevents the required cross-origin workflow.', validationQuestion: plan.question,
            limitations: [], character: 'direct', relation: 'contradicts', assumptionStatementHash: assumptionStatementHash(current),
            validationPlanHash: plan.contentHash, authoredBy: 'user',
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, sealAssumptionValidationEvent({
            id: 'technical-evidence-event', planningRecordId: current.id, actor: 'user', type: 'validation_evidence_recorded', at: 120,
            assumptionStatementHash: assumptionStatementHash(current), evidence, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const projection = projectAssumptionValidation(current, 130);
        const outcome = sealAssumptionValidationEvent({
            id: 'technical-outcome', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 130,
            assumptionStatementHash: assumptionStatementHash(current), conclusion: 'contradicted',
            caveats: 'The required workflow is infeasible in supported browsers.',
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, outcome)).toEqual({
            ok: true, duplicate: false,
        });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        expect(projectDecision(current)).toMatchObject({
            status: 'rejected', latestVerdictEventId: 'assumption-validation-verdict-technical-outcome',
        });
        expect(current.events?.at(-1)).toMatchObject({
            id: 'assumption-validation-verdict-technical-outcome', type: 'premise_rejected', actor: 'user',
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, outcome)).toEqual({
            ok: true, duplicate: true,
        });

        const currentProjection = projectAssumptionValidation(current, 131);
        const reopened = sealAssumptionValidationEvent({
            id: 'technical-outcome-reopened', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_reopened', at: 131,
            assumptionStatementHash: assumptionStatementHash(current),
            previousOutcomeEventId: currentProjection.latestOutcomeEventId!,
            reason: 'A new browser test produced contradictory evidence.',
            expectedValidationPlanHash: currentProjection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(currentProjection.activeEvidence),
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, reopened)).toEqual({
            ok: true, duplicate: false,
        });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        expect(projectAssumptionValidation(current, 132)).toMatchObject({
            acceptedConclusion: undefined,
            hasHistoricalValidation: true,
        });
        expect(projectDecision(current)).toMatchObject({
            status: 'open', latestVerdictEventId: 'assumption-validation-verdict-technical-outcome-reopened',
        });
        expect(current.assumptionValidation?.events.at(-1)).toMatchObject({
            type: 'validation_outcome_reopened',
            reason: 'A new browser test produced contradictory evidence.',
        });

        expect(useProjectStore.getState().appendPlanningDecisionEvent('project-1', current.id, {
            id: 'concurrent-verdict', planningRecordId: current.id, actor: 'user', type: 'custom_answered',
            answer: 'A newer concurrent product conclusion.', at: 200,
        })).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const staleOutcome = sealAssumptionValidationEvent({
            id: 'stale-outcome', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 140,
            assumptionStatementHash: assumptionStatementHash(current), conclusion: 'inconclusive',
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id, staleOutcome)).toMatchObject({ ok: false });
        expect(useProjectStore.getState().planningRecords['project-1'][0].assumptionValidation?.events.some(event => event.id === 'stale-outcome')).toBe(false);
    });

    const prepareCurrentEvidence = () => {
        let current = createAssumption();
        const plan = sealAssumptionValidationPlan({
            id: 'correction-plan', question: 'Will creators attempt checkout at $20?',
            method: { kind: 'prototype', label: 'Checkout prototype' },
            supportSignals: ['Checkout attempt'], contradictionSignals: ['Price abandonment'],
            inconclusiveConditions: [], limitations: ['No real payment'], authoredBy: 'user', createdAt: 110,
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'correction-plan-event', planningRecordId: current.id, actor: 'user',
                type: 'validation_plan_recorded', at: 110,
                assumptionStatementHash: assumptionStatementHash(current), plan,
                expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
            }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const evidence = sealAssumptionEvidence({
            id: 'evidence-to-correct', planningRecordId: current.id, sourceType: 'prototype',
            source: 'Checkout session', sourceIdentity: 'checkout-1', observedAt: 119, recordedAt: 120,
            observation: 'The participant attempted checkout.', validationQuestion: plan.question,
            scopeOrSample: 'One creator', limitations: ['No real charge'], character: 'direct', relation: 'supports',
            assumptionStatementHash: assumptionStatementHash(current), validationPlanHash: plan.contentHash,
            authoredBy: 'user',
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'evidence-to-correct-event', planningRecordId: current.id, actor: 'user',
                type: 'validation_evidence_recorded', at: 120,
                assumptionStatementHash: assumptionStatementHash(current), evidence,
                expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
            }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const projection = projectAssumptionValidation(current, 121);
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'evidence-outcome', planningRecordId: current.id, actor: 'user',
                type: 'validation_outcome_recorded', at: 121,
                assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported',
                expectedValidationPlanHash: plan.contentHash,
                expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        return { current, evidence, plan };
    };

    const exactGuard = (current: PlanningRecord, evidenceId: string, evidenceContentHash: string) => ({
        evidenceId,
        expectedEvidenceContentHash: evidenceContentHash,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projectAssumptionValidation(current, 130).activeEvidence),
        expectedSpineVersionId: 'spine-1',
        expectedSpineContentHash: planningContentHash('Current plan'),
        reason: 'The observation was recorded incorrectly and must not support the conclusion.',
    });

    it('retracts exact evidence with user authority and makes prior conclusions historical', () => {
        const { current, evidence } = prepareCurrentEvidence();
        expect(projectAssumptionValidation(current, 130).conclusionIsCurrent).toBe(true);

        const result = useProjectStore.getState().retractAssumptionEvidence(
            'project-1', current.id, exactGuard(current, evidence.id, evidence.contentHash),
        );
        expect(result).toMatchObject({ ok: true, eventIds: [expect.any(String)] });
        const stored = useProjectStore.getState().planningRecords['project-1'][0];
        const restored = JSON.parse(JSON.stringify(stored)) as PlanningRecord;
        expect(projectAssumptionValidation(restored, 140)).toMatchObject({
            activeEvidence: [], conclusionIsCurrent: false, acceptedConclusion: undefined,
            hasHistoricalValidation: true,
        });
        expect(stored.assumptionValidation?.events.at(-1)).toMatchObject({
            type: 'validation_evidence_retracted', evidenceId: evidence.id,
            evidenceContentHash: evidence.contentHash,
            reason: expect.stringContaining('recorded incorrectly'),
            actor: 'user',
        });
    });

    it('makes a readiness checkpoint historical when evidence supporting it is retracted', () => {
        const { current, evidence } = prepareCurrentEvidence();
        const readinessInput = (planningRecord: PlanningRecord, createdAt: number) => ({
            projectId: 'project-1',
            spine: {
                versionId: 'spine-1', content: 'Current plan', incompleteSectionCount: 0,
                isCommitted: false,
            },
            planningRecords: [planningRecord],
            reviewRuns: [], specialistRuns: [], reviewIssues: [], reviewFindings: [],
            outputAlignment: {
                outputs: [], alignedCount: 0, possiblyAffectedCount: 0, staleCount: 0, blockingCount: 0,
            },
            createdAt,
        });
        const review = deriveReadinessReview(readinessInput(current, 130));
        expect(useProjectStore.getState().retractAssumptionEvidence(
            'project-1', current.id, exactGuard(current, evidence.id, evidence.contentHash),
        )).toMatchObject({ ok: true });
        const changed = useProjectStore.getState().planningRecords['project-1'][0];
        expect(compareReadinessReviewCurrentness(review, readinessInput(changed, 140))).toMatchObject({
            current: false,
            historical: true,
            reasons: expect.arrayContaining(['planning_state_changed']),
        });
    });

    it('corrects evidence atomically while preserving the original and correction reason', () => {
        const { current, evidence } = prepareCurrentEvidence();
        const beforeEvents = current.assumptionValidation?.events.length ?? 0;
        const result = useProjectStore.getState().correctAssumptionEvidence('project-1', current.id, {
            ...exactGuard(current, evidence.id, evidence.contentHash),
            replacement: {
                sourceType: evidence.sourceType, source: evidence.source, sourceIdentity: evidence.sourceIdentity,
                observedAt: evidence.observedAt, observation: 'The participant abandoned when the price appeared.',
                scopeOrSample: evidence.scopeOrSample, limitations: evidence.limitations,
                character: evidence.character, relation: 'contradicts',
            },
        });
        expect(result).toMatchObject({ ok: true, evidenceId: expect.any(String), eventIds: [expect.any(String), expect.any(String)] });
        const stored = useProjectStore.getState().planningRecords['project-1'][0];
        const projection = projectAssumptionValidation(stored, 140);
        expect(stored.assumptionValidation?.events).toHaveLength(beforeEvents + 2);
        expect(projection.activeEvidence).toHaveLength(1);
        expect(projection.activeEvidence[0]).toMatchObject({
            id: result.ok ? result.evidenceId : '', relation: 'contradicts',
            observation: 'The participant abandoned when the price appeared.',
        });
        expect(projection.activeEvidence.some(item => item.id === evidence.id)).toBe(false);
        expect(projection.conclusionIsCurrent).toBe(false);
        expect(stored.assumptionValidation?.events.some(event => (
            event.type === 'validation_evidence_recorded' && event.evidence.id === evidence.id
        ))).toBe(true);
        expect(stored.assumptionValidation?.events.at(-1)).toMatchObject({
            type: 'validation_evidence_retracted', evidenceId: evidence.id,
            reason: expect.stringContaining('recorded incorrectly'),
        });
    });

    it('rejects stale, tampered, wrong-assumption, and no-op mutations without partial history', () => {
        const { current, evidence } = prepareCurrentEvidence();
        const before = JSON.stringify(current.assumptionValidation?.events);
        const replacement = {
            sourceType: evidence.sourceType, source: evidence.source, sourceIdentity: evidence.sourceIdentity,
            observedAt: evidence.observedAt, observation: 'A corrected observation.',
            scopeOrSample: evidence.scopeOrSample, limitations: evidence.limitations,
            character: evidence.character, relation: evidence.relation,
        };

        expect(useProjectStore.getState().correctAssumptionEvidence('project-1', current.id, {
            ...exactGuard(current, evidence.id, evidence.contentHash), expectedEvidenceSetHash: 'stale', replacement,
        })).toMatchObject({ ok: false });
        expect(useProjectStore.getState().retractAssumptionEvidence('project-1', current.id, {
            ...exactGuard(current, evidence.id, 'tampered'),
        })).toMatchObject({ ok: false });
        expect(useProjectStore.getState().retractAssumptionEvidence('project-1', current.id, {
            ...exactGuard(current, 'evidence-from-another-assumption', evidence.contentHash),
        })).toMatchObject({ ok: false });
        expect(useProjectStore.getState().correctAssumptionEvidence('project-1', current.id, {
            ...exactGuard(current, evidence.id, evidence.contentHash),
            replacement: {
                sourceType: evidence.sourceType, source: evidence.source, sourceIdentity: evidence.sourceIdentity,
                observedAt: evidence.observedAt, observation: evidence.observation,
                scopeOrSample: evidence.scopeOrSample, limitations: evidence.limitations,
                character: evidence.character, relation: evidence.relation,
            },
        })).toMatchObject({ ok: false, reason: expect.stringContaining('does not change') });
        expect(JSON.stringify(useProjectStore.getState().planningRecords['project-1'][0].assumptionValidation?.events)).toBe(before);
    });

    it('rejects concurrent plan changes and duplicate replacement sources without partial history', () => {
        const prepared = prepareCurrentEvidence();
        let current = prepared.current;
        const { evidence, plan } = prepared;
        const projection = projectAssumptionValidation(current, 130);
        const other = sealAssumptionEvidence({
            id: 'other-evidence', planningRecordId: current.id, sourceType: 'prototype',
            source: 'Other checkout session', sourceIdentity: 'checkout-2', observedAt: 122, recordedAt: 122,
            observation: 'A second participant attempted checkout.', validationQuestion: plan.question,
            limitations: [], character: 'direct', relation: 'supports',
            assumptionStatementHash: assumptionStatementHash(current), validationPlanHash: plan.contentHash,
            authoredBy: 'user',
        });
        expect(useProjectStore.getState().appendAssumptionValidationEvent('project-1', current.id,
            sealAssumptionValidationEvent({
                id: 'other-evidence-event', planningRecordId: current.id, actor: 'user',
                type: 'validation_evidence_recorded', at: 122,
                assumptionStatementHash: assumptionStatementHash(current), evidence: other,
                expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            }))).toMatchObject({ ok: true });
        current = useProjectStore.getState().planningRecords['project-1'][0];
        const before = JSON.stringify(current.assumptionValidation?.events);
        const guard = exactGuard(current, evidence.id, evidence.contentHash);
        expect(useProjectStore.getState().correctAssumptionEvidence('project-1', current.id, {
            ...guard,
            replacement: {
                sourceType: other.sourceType, source: 'Duplicate correction', sourceIdentity: other.sourceIdentity,
                observedAt: other.observedAt, observation: 'A corrected observation using an existing source.',
                limitations: [], character: other.character, relation: other.relation,
            },
        })).toMatchObject({ ok: false, reason: expect.stringContaining('duplicates another active source') });
        expect(JSON.stringify(useProjectStore.getState().planningRecords['project-1'][0].assumptionValidation?.events)).toBe(before);

        useProjectStore.setState({
            spineVersions: { 'project-1': [{
                id: 'spine-2', projectId: 'project-1', promptText: 'Plan', responseText: 'Changed plan',
                createdAt: 2, isLatest: true, isFinal: false,
            }] },
        });
        expect(useProjectStore.getState().retractAssumptionEvidence('project-1', current.id, guard)).toMatchObject({
            ok: false,
            reason: expect.stringContaining('plan changed'),
        });
        expect(JSON.stringify(useProjectStore.getState().planningRecords['project-1'][0].assumptionValidation?.events)).toBe(before);
    });
});
