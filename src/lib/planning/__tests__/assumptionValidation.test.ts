import { describe, expect, it } from 'vitest';
import type {
    AssumptionEvidenceRecord,
    AssumptionValidationEvent,
    AssumptionValidationPlan,
    PlanningRecord,
} from '../../../types';
import {
    addAssumptionInterpretationProposal,
    addAssumptionValidationPlanProposal,
    appendAssumptionValidationEvent,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    buildAssumptionInterpretationProposal,
    buildAssumptionValidationPlanProposal,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../assumptionValidation';

const record = (patch: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'assumption-1',
    projectId: 'project-1',
    type: 'assumption',
    status: 'open',
    title: 'People will pay',
    statement: 'Independent creators will pay $20 per month.',
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
});

const emptyEvidenceHash = assumptionEvidenceSetHash([]);

const plan = (createdAt = 10): AssumptionValidationPlan => sealAssumptionValidationPlan({
    id: 'plan-1',
    question: 'Will independent creators pay $20 per month after a 14-day trial?',
    method: { kind: 'user_interviews', label: 'Five price-tested interviews' },
    supportSignals: ['Three participants attempt checkout at $20.'],
    contradictionSignals: ['Participants abandon after seeing the price.'],
    inconclusiveConditions: ['Participants say yes without a purchase action.'],
    limitations: ['Small early-adopter sample.'],
    authoredBy: 'user',
    createdAt,
});

const planEvent = (item: PlanningRecord, at = 10, itemPlan = plan(at)): AssumptionValidationEvent =>
    sealAssumptionValidationEvent({
        id: `plan-event-${at}`,
        planningRecordId: item.id,
        actor: 'user',
        type: 'validation_plan_recorded',
        at,
        assumptionStatementHash: assumptionStatementHash(item),
        plan: itemPlan,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projectAssumptionValidation(item, at).activeEvidence),
    });

const append = (item: PlanningRecord, event: AssumptionValidationEvent): PlanningRecord => {
    const result = appendAssumptionValidationEvent(item, event);
    if (!result.ok) throw new Error(result.reason);
    return result.record;
};

const evidence = (
    item: PlanningRecord,
    id: string,
    sourceIdentity: string,
    relation: AssumptionEvidenceRecord['relation'],
    at: number,
): AssumptionEvidenceRecord => {
    const projection = projectAssumptionValidation(item, at);
    if (!projection.currentPlan) throw new Error('plan required');
    return sealAssumptionEvidence({
        id,
        planningRecordId: item.id,
        sourceType: 'user_interview',
        source: `Interview ${sourceIdentity}`,
        sourceIdentity,
        observedAt: at - 1,
        recordedAt: at,
        observation: relation === 'supports' ? 'Participant attempted checkout.' : 'Participant abandoned checkout.',
        validationQuestion: projection.currentPlan.question,
        scopeOrSample: 'One independent creator',
        limitations: ['Single participant'],
        character: 'direct',
        relation,
        assumptionStatementHash: assumptionStatementHash(item),
        validationPlanHash: projection.currentPlan.contentHash,
        authoredBy: 'user',
    });
};

const evidenceEvent = (item: PlanningRecord, itemEvidence: AssumptionEvidenceRecord, at: number): AssumptionValidationEvent =>
    sealAssumptionValidationEvent({
        id: `evidence-event-${itemEvidence.id}`,
        planningRecordId: item.id,
        actor: 'user',
        type: 'validation_evidence_recorded',
        at,
        assumptionStatementHash: assumptionStatementHash(item),
        evidence: itemEvidence,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projectAssumptionValidation(item, at).activeEvidence),
    });

describe('assumption validation domain', () => {
    it('projects legacy confirmed assumptions as accepted without validation', () => {
        const projection = projectAssumptionValidation(record({ status: 'confirmed' }), 100);
        expect(projection).toMatchObject({
            workflowState: 'not_planned',
            conclusionIsCurrent: false,
            userTreatment: 'accepted_without_validation',
            hasHistoricalValidation: false,
        });
        expect(projection.acceptedConclusion).toBeUndefined();
    });

    it('keeps generated plans advisory until a user records a plan event', () => {
        const initial = record();
        const proposal = buildAssumptionValidationPlanProposal({
            record: initial,
            question: 'Will creators pay?',
            method: { kind: 'user_interviews', label: 'Price interviews' },
            supportSignals: ['Attempted purchase'],
            contradictionSignals: ['Refused purchase'],
            createdAt: 5,
        });
        const added = addAssumptionValidationPlanProposal(initial, proposal);
        expect(added.ok).toBe(true);
        if (!added.ok) return;
        expect(projectAssumptionValidation(added.record, 6).workflowState).toBe('not_planned');
        expect(added.record.assumptionValidation?.events).toHaveLength(0);
    });

    it('moves through planned, in progress, and completed without conflating treatment', () => {
        let current = append(record(), planEvent(record()));
        expect(projectAssumptionValidation(current, 11).workflowState).toBe('planned');

        const observed = evidence(current, 'evidence-1', 'interview-001', 'supports', 20);
        current = append(current, evidenceEvent(current, observed, 20));
        expect(projectAssumptionValidation(current, 21)).toMatchObject({
            workflowState: 'in_progress',
            acceptedConclusion: undefined,
            userTreatment: undefined,
        });

        const projection = projectAssumptionValidation(current, 30);
        current = append(current, sealAssumptionValidationEvent({
            id: 'outcome-1',
            planningRecordId: current.id,
            actor: 'user',
            type: 'validation_outcome_recorded',
            at: 30,
            assumptionStatementHash: assumptionStatementHash(current),
            conclusion: 'partially_supported',
            caveats: 'Only one interview so far.',
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        }));
        expect(projectAssumptionValidation(current, 31)).toMatchObject({
            workflowState: 'completed',
            acceptedConclusion: 'partially_supported',
            conclusionIsCurrent: true,
            userTreatment: undefined,
        });
    });

    it('requires user authority and event integrity', () => {
        const initial = record();
        const valid = planEvent(initial);
        const modelAuthored = { ...valid, actor: 'synapse' } as unknown as AssumptionValidationEvent;
        expect(appendAssumptionValidationEvent(initial, modelAuthored)).toMatchObject({
            ok: false,
            reason: 'Only a user may record validation authority.',
        });
        const tampered = { ...valid, assumptionStatementHash: 'forged' };
        expect(appendAssumptionValidationEvent(initial, tampered)).toMatchObject({
            ok: false,
            reason: 'Validation event integrity check failed.',
        });
    });

    it('fails safely when the assumption or exact plan version changes', () => {
        const initial = record();
        const { integrityHash: _integrityHash, ...draft } = planEvent(initial);
        const event = sealAssumptionValidationEvent({
            ...draft,
            id: 'version-plan',
            expectedSpineVersionId: 'spine-1',
            expectedSpineContentHash: 'content-1',
        });
        const changedAssumption = { ...initial, statement: 'Creators will pay $30.' };
        expect(appendAssumptionValidationEvent(changedAssumption, event, {
            currentSpineVersionId: 'spine-1', currentSpineContentHash: 'content-1',
        })).toMatchObject({ ok: false });
        expect(appendAssumptionValidationEvent(initial, event, {
            currentSpineVersionId: 'spine-2', currentSpineContentHash: 'content-2',
        })).toMatchObject({ ok: false, reason: 'The plan changed before this validation action was recorded.' });
    });

    it('retains duplicate evidence but excludes it from independent corroboration', () => {
        const initial = record();
        let current = append(initial, planEvent(initial));
        const first = evidence(current, 'evidence-1', 'source-url-1', 'supports', 20);
        current = append(current, evidenceEvent(current, first, 20));
        const repeated = evidence(current, 'evidence-2', ' SOURCE-url-1 ', 'supports', 21);
        const result = appendAssumptionValidationEvent(current, evidenceEvent(current, repeated, 21));
        expect(result).toMatchObject({ ok: true, duplicate: false, duplicateEvidenceOf: 'evidence-1' });
        if (!result.ok) return;
        expect(projectAssumptionValidation(result.record, 22)).toMatchObject({
            duplicateEvidenceIds: ['evidence-2'],
        });
        expect(projectAssumptionValidation(result.record, 22).independentEvidence).toHaveLength(1);
    });

    it('does not infer support from evidence existence and keeps contradictions inconclusive', () => {
        const initial = record();
        let current = append(initial, planEvent(initial));
        for (const [id, identity, relation, at] of [
            ['supports', 'interview-1', 'supports', 20],
            ['contradicts', 'observation-1', 'contradicts', 21],
            ['irrelevant', 'market-report-1', 'irrelevant', 22],
        ] as const) {
            const item = evidence(current, id, identity, relation, at);
            current = append(current, evidenceEvent(current, item, at));
        }
        const proposal = buildAssumptionInterpretationProposal({
            record: current,
            reasoning: 'Observed evidence points in different directions.',
            createdAt: 30,
        });
        expect(proposal).toMatchObject({
            recommendedConclusion: 'inconclusive',
            supportingEvidenceIds: ['supports'],
            contradictingEvidenceIds: ['contradicts'],
            irrelevantEvidenceIds: ['irrelevant'],
        });
        const added = addAssumptionInterpretationProposal(current, proposal);
        expect(added.ok).toBe(true);
        if (!added.ok) return;
        expect(projectAssumptionValidation(added.record, 31).acceptedConclusion).toBeUndefined();
    });

    it('invalidates a recorded outcome when evidence changes while preserving history', () => {
        const initial = record();
        let current = append(initial, planEvent(initial));
        const first = evidence(current, 'evidence-1', 'interview-1', 'supports', 20);
        current = append(current, evidenceEvent(current, first, 20));
        let projection = projectAssumptionValidation(current, 30);
        current = append(current, sealAssumptionValidationEvent({
            id: 'outcome-1', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 30,
            assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported',
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        }));
        const next = evidence(current, 'evidence-2', 'interview-2', 'contradicts', 40);
        current = append(current, evidenceEvent(current, next, 40));
        projection = projectAssumptionValidation(current, 41);
        expect(projection).toMatchObject({
            workflowState: 'due_for_review',
            conclusionIsCurrent: false,
            latestOutcomeEventId: 'outcome-1',
        });
        expect(current.assumptionValidation?.events.some(event => event.id === 'outcome-1')).toBe(true);
    });

    it('makes expired conclusions due for review without deleting the historical outcome', () => {
        const initial = record();
        const { contentHash: _contentHash, ...planDraft } = plan(10);
        const sealedExpiring = sealAssumptionValidationPlan({ ...planDraft, expiresAt: 50 });
        let current = append(initial, planEvent(initial, 10, sealedExpiring));
        const first = evidence(current, 'evidence-1', 'test-1', 'supports', 20);
        current = append(current, evidenceEvent(current, first, 20));
        const projection = projectAssumptionValidation(current, 30);
        current = append(current, sealAssumptionValidationEvent({
            id: 'outcome-1', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 30,
            assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported', revisitAt: 50,
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        }));
        expect(projectAssumptionValidation(current, 51)).toMatchObject({
            workflowState: 'due_for_review',
            conclusionIsCurrent: false,
            latestOutcomeEventId: 'outcome-1',
        });
    });

    it('preserves historical replay across serialization and ignores tampered stored evidence', () => {
        const initial = record();
        let current = append(initial, planEvent(initial));
        const first = evidence(current, 'evidence-1', 'interview-1', 'supports', 20);
        current = append(current, evidenceEvent(current, first, 20));
        const restored = JSON.parse(JSON.stringify(current)) as PlanningRecord;
        expect(projectAssumptionValidation(restored, 21).independentEvidence).toHaveLength(1);

        const tampered = structuredClone(restored);
        const event = tampered.assumptionValidation?.events.find(item => item.type === 'validation_evidence_recorded');
        if (event?.type === 'validation_evidence_recorded') event.evidence.observation = 'Fabricated replacement.';
        const projection = projectAssumptionValidation(tampered, 21);
        expect(projection.independentEvidence).toHaveLength(0);
        expect(projection.invalidEventIds).toContain('evidence-event-evidence-1');
    });

    it('rejects evidence attached to another assumption and unsupported conclusions with no evidence', () => {
        const initial = record();
        const planned = append(initial, planEvent(initial));
        const foreign = evidence(planned, 'foreign', 'interview-x', 'supports', 20);
        foreign.planningRecordId = 'another-assumption';
        expect(appendAssumptionValidationEvent(planned, evidenceEvent(planned, foreign, 20))).toMatchObject({ ok: false });

        const projection = projectAssumptionValidation(planned, 30);
        const outcome = sealAssumptionValidationEvent({
            id: 'unsupported-outcome', planningRecordId: planned.id, actor: 'user', type: 'validation_outcome_recorded', at: 30,
            assumptionStatementHash: assumptionStatementHash(planned), conclusion: 'supported',
            expectedValidationPlanHash: projection.currentPlan!.contentHash,
            expectedEvidenceSetHash: emptyEvidenceHash,
        });
        expect(appendAssumptionValidationEvent(planned, outcome)).toMatchObject({
            ok: false,
            reason: 'This conclusion requires at least one current, independent evidence source.',
        });
    });
});
