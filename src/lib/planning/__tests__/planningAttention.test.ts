import { describe, expect, it } from 'vitest';
import type { PlanningRecord, ReviewIssue, StructuredPRD } from '../../../types';
import type { DownstreamUpdatePlanSummary, DownstreamUpdatePlanSummaryItem } from '../downstreamUpdatePlan';
import type { OutputAlignment } from '../outputAlignment';
import { deriveAnswerableAssumptionRecords, derivePlanningAttention, type PlanningAttentionInput } from '../planningAttention';
import {
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    sealAssumptionValidationEvent,
} from '../assumptionValidation';

const prd: StructuredPRD = {
    vision: 'Help teams decide what to build before implementation begins.',
    coreProblem: 'Teams can polish plans before resolving consequential uncertainty.',
    targetUsers: ['Product teams planning a consequential new product'],
    architecture: 'Web application',
    risks: [],
    successMetrics: [{ name: 'Trusted plans', target: 'Material uncertainty is resolved before implementation' }],
    features: [{
        id: 'f1', name: 'Decision workflow', description: 'Resolve consequential choices',
        userValue: 'Clarity before implementation', complexity: 'medium', confirmed: true,
    }],
};

const record = (overrides: Partial<PlanningRecord> = {}): PlanningRecord => ({
    id: 'record-1', projectId: 'project-1', type: 'decision', status: 'open',
    title: 'Choose the account model', statement: 'Decide whether an account is required.',
    whyItMatters: 'Onboarding and persistence depend on this choice.',
    evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
    materiality: 'high',
    ...overrides,
});

const issue = (overrides: Partial<ReviewIssue> = {}): ReviewIssue => ({
    id: 'issue-1', projectId: 'project-1', reviewId: 'review-1',
    title: 'Account behavior conflicts with recovery',
    summary: 'The current recovery flow assumes an account exists.',
    kind: 'contradiction', findingIds: ['finding-1'], specialistIds: ['product'],
    relationship: 'standalone', severity: 'high', confidence: 'high',
    implementationImpact: 'resolve_before_build', status: 'open', dispositions: [],
    relatedPlanningRecordIds: [], createdAt: 1, updatedAt: 1,
    ...overrides,
});

const base = (overrides: Partial<PlanningAttentionInput> = {}): PlanningAttentionInput => ({
    prd,
    planningRecords: [],
    incompleteSectionCount: 0,
    hasCurrentChallenge: true,
    blockingReviewIssueCount: 0,
    generatedOutputCount: 0,
    staleOutputCount: 0,
    evaluatedAt: 100,
    currentSpineVersionId: 'spine-1',
    currentSpineContentHash: 'hash-1',
    ...overrides,
});

const updateItem = (
    certainty: DownstreamUpdatePlanSummaryItem['certainty'],
    overrides: Partial<DownstreamUpdatePlanSummaryItem> = {},
): DownstreamUpdatePlanSummaryItem => ({
    planId: `plan-${certainty}`, planIntegrityHash: `integrity-${certainty}`,
    itemId: `item-${certainty}`, artifactId: `artifact-${certainty}`,
    artifactVersionId: `artifact-version-${certainty}`, nodeId: 'screen_inventory',
    artifactTitle: certainty === 'definite' ? 'Screens' : 'User flows',
    region: certainty === 'definite'
        ? { kind: 'screen', screenId: 'shared', screenName: 'Shared workspace', aspect: 'behavior' }
        : { kind: 'flow', flowId: 'onboarding', flowName: 'Onboarding', aspect: 'branch', stepIndex: 2 },
    certainty, implementationCritical: true, priority: certainty === 'definite' ? 1 : 2,
    recommendation: certainty === 'definite'
        ? 'Remove the obsolete shared-workspace behavior.'
        : 'Review whether the onboarding branch still applies.',
    ...overrides,
});

const summary = (
    blockingItems: DownstreamUpdatePlanSummaryItem[],
    advisoryItems: DownstreamUpdatePlanSummaryItem[],
): DownstreamUpdatePlanSummary => ({
    currentPlanCount: 1, historicalPlanCount: 0, blockingItems, advisoryItems,
    reviewedItems: [], snapshotHash: 'snapshot-1',
});

describe('planning attention projection', () => {
    it('keeps the existing live-readiness action primary and limits secondary attention', () => {
        const result = derivePlanningAttention(base({
            incompleteSectionCount: 1,
            planningRecords: [
                record({ id: 'decision-1' }),
                record({ id: 'decision-2', type: 'conflict', title: 'Resolve conflicting access rules' }),
                record({ id: 'risk-1', type: 'risk', title: 'Review account recovery risk' }),
                record({ id: 'question-1', type: 'open_question', title: 'Choose the launch audience' }),
            ],
        }));

        expect(result.readiness.nextAction.kind).toBe('clarify_foundation');
        expect(result.primary).toMatchObject({
            key: 'foundation:current-plan',
            condition: 'clarify_foundation',
        });
        expect(result.secondary).toHaveLength(3);
        expect(result.totalCount).toBe(5);
        expect(result.hiddenCount).toBe(1);
    });

    it('deduplicates a linked challenge under the durable planning-record identity', () => {
        const planningRecord = record({ id: 'account-decision' });
        const result = derivePlanningAttention(base({
            planningRecords: [planningRecord],
            reviewIssues: [issue({ relatedPlanningRecordIds: [planningRecord.id] })],
            blockingReviewIssueCount: 1,
        }));

        expect(result.totalCount).toBe(1);
        expect(result.primary).toMatchObject({
            key: 'record:account-decision',
            title: planningRecord.title,
            destination: { kind: 'planning_record', recordId: planningRecord.id },
        });
        expect(result.primary?.sourceRefs).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'planning_record', id: planningRecord.id }),
            expect.objectContaining({ kind: 'challenge', id: 'issue-1' }),
        ]));
    });

    it('keeps an unlinked challenge as its own durable attention item', () => {
        const result = derivePlanningAttention(base({
            reviewIssues: [issue()],
            blockingReviewIssueCount: 1,
        }));

        expect(result.readiness.nextAction.kind).toBe('challenge_plan');
        expect(result.primary).toMatchObject({
            key: 'challenge:issue-1',
            condition: 'challenge_finding',
            destination: { kind: 'challenge', reviewId: 'review-1', issueId: 'issue-1' },
        });
    });

    it('keeps a currently accepted assumption quiet until its revisit or context changes', () => {
        const accepted = record({
            id: 'accepted-assumption', type: 'assumption', status: 'confirmed',
            title: 'Creators will pay $20 per month',
            statement: 'Independent creators will pay $20 per month.',
            createdBy: 'migration',
        });
        const quiet = derivePlanningAttention(base({ planningRecords: [accepted] }));
        expect(quiet.primary).toBeUndefined();
        expect(quiet.totalCount).toBe(0);

        const changed = derivePlanningAttention(base({
            planningRecords: [{ ...accepted, sourceState: 'changed' }],
        }));
        expect(changed.primary).toMatchObject({
            key: 'record:accepted-assumption',
            condition: 'review_changed_context',
        });
    });

    it('surfaces an explicitly accepted risk only when its recorded revisit becomes due', () => {
        const accepted = record({
            id: 'time-bound-assumption', type: 'assumption', status: 'confirmed',
            title: 'Creators will pay $20 per month',
            statement: 'Independent creators will pay $20 per month.',
        });
        const treatment = sealAssumptionValidationEvent({
            id: 'accepted-risk-event', planningRecordId: accepted.id, actor: 'user',
            type: 'validation_uncertainty_treatment_recorded', at: 50,
            assumptionStatementHash: assumptionStatementHash(accepted),
            expectedSpineVersionId: 'spine-1', expectedSpineContentHash: 'hash-1',
            treatment: 'temporarily_tolerated',
            rationale: 'Proceed with a bounded pricing prototype before investing in billing.',
            revisitAt: 200,
            expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        });
        const withTreatment: PlanningRecord = {
            ...accepted,
            assumptionValidation: {
                schemaVersion: 1,
                events: [treatment],
                planProposals: [],
                interpretationProposals: [],
            },
        };

        expect(derivePlanningAttention(base({ planningRecords: [withTreatment], evaluatedAt: 100 })).totalCount).toBe(0);
        expect(derivePlanningAttention(base({ planningRecords: [withTreatment], evaluatedAt: 201 })).primary).toMatchObject({
            key: 'record:time-bound-assumption',
            condition: 'accepted_risk_due',
        });
    });

    it('keeps possible impact advisory while prioritizing a definite mismatch', () => {
        const definite = updateItem('definite');
        const possible = updateItem('possible');
        const result = derivePlanningAttention(base({
            generatedOutputCount: 2,
            downstreamUpdatePlanSummary: summary([definite], [possible]),
        }));

        expect(result.readiness.nextAction).toMatchObject({
            kind: 'align_outputs', artifactId: definite.artifactId,
        });
        expect(result.primary).toMatchObject({
            condition: 'update_required', materiality: 'blocking',
            destination: { kind: 'update_plan', planId: definite.planId, itemId: definite.itemId },
        });
        expect(result.secondary[0]).toMatchObject({
            condition: 'review_recommended', materiality: 'normal',
            destination: { kind: 'update_plan', planId: possible.planId, itemId: possible.itemId },
        });
    });

    it('uses artifact, region, and source identities instead of text for output dedupe', () => {
        const first = updateItem('possible', {
            planId: 'source-a', itemId: 'item-a', artifactId: 'screens',
            recommendation: 'Review the same visible behavior.',
        });
        const second = updateItem('possible', {
            planId: 'source-b', itemId: 'item-b', artifactId: 'screens',
            recommendation: 'Review the same visible behavior.',
        });
        const result = derivePlanningAttention(base({
            generatedOutputCount: 1,
            downstreamUpdatePlanSummary: summary([], [first, second]),
        }));

        // Readiness remains primary because the advisory items do not block
        // commitment; the two identical recommendations remain separate by
        // durable region/source identity.
        expect(result.totalCount).toBe(3);
        expect([result.primary, ...result.secondary].map(item => item?.key)).toEqual(expect.arrayContaining([
            expect.stringContaining('source:source-a'),
            expect.stringContaining('source:source-b'),
        ]));
    });

    it('treats missing legacy provenance as bounded review, not a definite update', () => {
        const legacy: OutputAlignment = {
            artifactId: 'legacy-data-model', nodeId: 'data_model', title: 'Data model',
            state: 'possibly_affected', confidence: 'unknown',
            summary: 'The source version is unavailable.', reasons: ['No provenance was recorded.'],
            nextAction: 'Review the data model.', usefulForExploration: true,
            blocksBuildReadiness: false,
        };
        const result = derivePlanningAttention(base({
            generatedOutputCount: 1,
            outputAlignments: [legacy],
        }));

        expect(result.primary).toMatchObject({ condition: 'ready_to_commit' });
        expect(result.secondary[0]).toMatchObject({
            key: 'legacy-artifact:legacy-data-model',
            condition: 'legacy_review',
            materiality: 'normal',
            actionableNow: true,
        });
        expect(result.secondary[0]?.why).toMatch(/without assuming it is wrong/i);
    });
});

describe('deriveAnswerableAssumptionRecords', () => {
    it('labels an open assumption as a question to answer, not a validation task', () => {
        const result = derivePlanningAttention(base({
            planningRecords: [record({ type: 'assumption', title: 'LLM pricing stays affordable' })],
        }));
        expect(result.primary).toMatchObject({
            condition: 'worth_validating',
            actionLabel: 'Answer this question',
        });
    });

    it('returns open material assumptions in attention order, excluding immaterial ones', () => {
        const records = [
            record({ id: 'a-high', type: 'assumption', materiality: 'high', title: 'High assumption' }),
            record({ id: 'a-low', type: 'assumption', materiality: 'low', title: 'Low assumption' }),
            record({ id: 'a-blocking', type: 'assumption', materiality: 'blocking', title: 'Blocking assumption' }),
        ];
        const result = deriveAnswerableAssumptionRecords(base({ planningRecords: records }));
        expect(result.map(item => item.id)).toEqual(['a-blocking', 'a-high']);
    });

    it('excludes settled assumptions, non-assumption records, and changed-source assumptions', () => {
        const confirmed = record({
            id: 'a-confirmed', type: 'assumption', status: 'confirmed',
            events: [{
                id: 'event-1', planningRecordId: 'a-confirmed', type: 'custom_answered',
                actor: 'user', at: 50, answer: 'Confirmed statement',
            }],
        });
        const decision = record({ id: 'd-open', type: 'decision' });
        const changedSource = record({ id: 'a-changed', type: 'assumption', sourceState: 'changed' });
        const open = record({ id: 'a-open', type: 'assumption' });
        const result = deriveAnswerableAssumptionRecords(base({
            planningRecords: [confirmed, decision, changedSource, open],
        }));
        expect(result.map(item => item.id)).toEqual(['a-open']);
    });
});
