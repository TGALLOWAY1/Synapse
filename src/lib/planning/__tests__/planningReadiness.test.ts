import { describe, expect, it } from 'vitest';
import type { AssumptionEvidenceConclusion, AssumptionEvidenceSourceType, PlanningRecord, ReviewIssue, StructuredPRD } from '../../../types';
import {
    appendAssumptionValidationEvent,
    appendDecisionEvent,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    assumptionValidationDecisionEvent,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '..';
import { derivePlanningReadiness, planningRecordNeedsAlignment, reviewIssueNeedsResolutionBeforeBuild } from '../planningReadiness';

const prd: StructuredPRD = {
    vision: 'Help teams decide what to build', coreProblem: 'Teams build polished plans before resolving product uncertainty.',
    targetUsers: ['Product teams planning a consequential new product'], architecture: 'Web application', risks: [],
    successMetrics: [{ name: 'Validated plans', target: 'Most projects resolve material questions before implementation' }],
    features: [{ id: 'f1', name: 'Decision workflow', description: 'Resolve choices', userValue: 'Clarity', complexity: 'medium', confirmed: true }],
};

const record = (type: PlanningRecord['type'], status: PlanningRecord['status']): PlanningRecord => ({
    id: `${type}-1`, projectId: 'p1', type, status, title: `Open ${type}`, statement: 'A consequential choice',
    evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
});

const validatedAssumption = (options: {
    conclusion?: AssumptionEvidenceConclusion;
    sourceType?: AssumptionEvidenceSourceType;
    relation?: 'supports' | 'contradicts' | 'inconclusive' | 'irrelevant';
    character?: 'direct' | 'interpretation';
    caveats?: string;
    expiresAt?: number;
    relations?: Array<'supports' | 'contradicts' | 'inconclusive' | 'irrelevant'>;
} = {}): PlanningRecord => {
    let current: PlanningRecord = {
        ...record('assumption', 'open'), id: 'validated-assumption', materiality: 'high', events: [],
        title: 'Creators will complete checkout', statement: 'Independent creators will pay $20 per month.',
        sources: [{ key: 'prd_assumption:a1', sourceType: 'prd_assumption', sourceId: 'a1', sourceVersionId: 'spine-1' }],
    };
    const spineHash = 'spine-content-hash';
    const context = { currentSpineVersionId: 'spine-1', currentSpineContentHash: spineHash };
    const sourceType = options.sourceType ?? 'prototype';
    const methodKind = sourceType === 'usability_observation' ? 'usability_observation' : 'prototype';
    const plan = sealAssumptionValidationPlan({
        id: 'plan', question: 'Will creators complete checkout at $20?',
        method: { kind: methodKind, label: methodKind === 'prototype' ? 'Price-tested checkout prototype' : 'Observed usability sessions' },
        supportSignals: ['A creator attempts checkout'], contradictionSignals: ['Creators abandon at price'],
        inconclusiveConditions: ['Verbal interest without behavior'], limitations: ['Prototype does not collect payment'],
        expiresAt: options.expiresAt, authoredBy: 'user', createdAt: 10,
    });
    const planResult = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
        id: 'plan-event', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 10,
        assumptionStatementHash: assumptionStatementHash(current), plan, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
        expectedSpineVersionId: 'spine-1', expectedSpineContentHash: spineHash,
    }), context);
    if (!planResult.ok) throw new Error(planResult.reason);
    current = planResult.record;
    const evidenceCount = ['prototype', 'usability_observation'].includes(sourceType) ? 2 : 1;
    for (let index = 0; index < evidenceCount; index += 1) {
        const projection = projectAssumptionValidation(current, 20 + index);
        const evidence = sealAssumptionEvidence({
            id: `evidence-${index}`, planningRecordId: current.id, sourceType,
            source: `Checkout session ${index + 1}`, sourceIdentity: `checkout-session-${index + 1}`, observedAt: 19 + index, recordedAt: 20 + index,
            observation: 'A participant attempted checkout after seeing the price.', validationQuestion: plan.question,
            scopeOrSample: 'One independent creator in a realistic checkout task', limitations: [], character: options.character ?? 'direct', relation: options.relations?.[index] ?? options.relation ?? 'supports',
            assumptionStatementHash: assumptionStatementHash(current), validationPlanHash: plan.contentHash, authoredBy: 'user',
        });
        const evidenceResult = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
            id: `evidence-event-${index}`, planningRecordId: current.id, actor: 'user', type: 'validation_evidence_recorded', at: 20 + index,
            assumptionStatementHash: assumptionStatementHash(current), evidence,
            expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
            expectedSpineVersionId: 'spine-1', expectedSpineContentHash: spineHash,
        }), context);
        if (!evidenceResult.ok) throw new Error(evidenceResult.reason);
        current = evidenceResult.record;
    }
    const projection = projectAssumptionValidation(current, 30);
    const outcome = sealAssumptionValidationEvent({
        id: 'outcome-event', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 30,
        assumptionStatementHash: assumptionStatementHash(current), conclusion: options.conclusion ?? 'supported',
        caveats: options.caveats, expectedValidationPlanHash: projection.currentPlan!.contentHash,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
        expectedSpineVersionId: 'spine-1', expectedSpineContentHash: spineHash,
    });
    const outcomeResult = appendAssumptionValidationEvent(current, outcome, context);
    if (!outcomeResult.ok) throw new Error(outcomeResult.reason);
    const verdict = assumptionValidationDecisionEvent(current, outcome)!;
    const verdictResult = appendDecisionEvent(outcomeResult.record, verdict);
    if (!verdictResult.ok) throw new Error(verdictResult.reason);
    return verdictResult.record;
};

describe('planning readiness', () => {
    it('prioritizes unresolved decisions over artifact completion', () => {
        const result = derivePlanningReadiness({
            prd, planningRecords: [record('open_question', 'open')], incompleteSectionCount: 0,
            hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 8, staleOutputCount: 0,
        });
        expect(result.phase).toBe('needs_decisions');
        expect(result.nextAction).toMatchObject({ kind: 'resolve_decision', planningRecordId: 'open_question-1' });
    });

    it('does not penalize a plan merely because no outputs were generated', () => {
        const result = derivePlanningReadiness({
            prd, planningRecords: [], incompleteSectionCount: 0, hasCurrentChallenge: true,
            blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0,
        });
        expect(result.isReadyToBuild).toBe(true);
        expect(result.criteria.find(item => item.id === 'alignment')?.status).toBe('not_started');
    });

    it('does not treat one confirmed feature as confirmation of the whole first release', () => {
        const result = derivePlanningReadiness({
            prd: {
                ...prd,
                features: [
                    { ...prd.features[0], tier: 'mvp', confirmed: true },
                    { ...prd.features[0], id: 'f2', name: 'Generated extra', tier: 'mvp', confirmed: undefined },
                ],
            },
            planningRecords: [], incompleteSectionCount: 0, hasCurrentChallenge: true,
            blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0,
        });
        expect(result.isReadyToBuild).toBe(false);
        expect(result.nextAction.kind).toBe('confirm_scope');
    });

    it('surfaces source drift before a nominally confirmed decision', () => {
        const changed = { ...record('decision', 'confirmed'), sourceState: 'changed' as const };
        const result = derivePlanningReadiness({
            prd, planningRecords: [changed], incompleteSectionCount: 0, hasCurrentChallenge: true,
            blockingReviewIssueCount: 0, generatedOutputCount: 1, staleOutputCount: 0,
        });
        expect(result.isReadyToBuild).toBe(false);
        expect(result.nextAction.kind).toBe('review_source_change');
    });

    it('blocks build readiness for a high-impact assumption but not a low-impact one', () => {
        const high = { ...record('assumption', 'open'), id: 'high', materiality: 'high' as const };
        const low = { ...record('assumption', 'open'), id: 'low', materiality: 'low' as const };
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [high] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [low] }).isReadyToBuild).toBe(true);
    });

    it('routes a material assumption to validation and clears it only with credible synchronized evidence', () => {
        const open = { ...record('assumption', 'open'), id: 'assumption-to-validate', materiality: 'high' as const };
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0, evaluatedAt: 40 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [open] }).nextAction).toMatchObject({
            kind: 'validate_assumption', planningRecordId: 'assumption-to-validate',
        });
        expect(derivePlanningReadiness({ ...shared, planningRecords: [validatedAssumption()] }).isReadyToBuild).toBe(true);
    });

    it('does not mistake a sole stakeholder assertion, irrelevant source, or interpretation for validation', () => {
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0, evaluatedAt: 40 };
        const weak = validatedAssumption({ sourceType: 'stakeholder_statement' });
        const irrelevant = validatedAssumption({ relation: 'irrelevant' });
        const interpreted = validatedAssumption({ character: 'interpretation' });
        for (const assumption of [weak, irrelevant, interpreted]) {
            const readiness = derivePlanningReadiness({ ...shared, planningRecords: [assumption] });
            expect(readiness.isReadyToBuild).toBe(false);
            expect(readiness.nextAction.kind).toBe('validate_assumption');
        }
    });

    it('supports a qualified usability conclusion while preserving contradictory uncertainty', () => {
        const qualified = validatedAssumption({
            conclusion: 'partially_supported', sourceType: 'usability_observation', caveats: 'The core flow worked, but onboarding caused a serious failure.',
        });
        const noCaveat = validatedAssumption({ conclusion: 'partially_supported', sourceType: 'usability_observation' });
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0, evaluatedAt: 40 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [qualified] }).isReadyToBuild).toBe(true);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [noCaveat] }).isReadyToBuild).toBe(false);
        const competing = validatedAssumption({
            conclusion: 'partially_supported', sourceType: 'usability_observation',
            caveats: 'The evidence conflicts.', relations: ['supports', 'contradicts'],
        });
        expect(derivePlanningReadiness({ ...shared, planningRecords: [competing] }).isReadyToBuild).toBe(false);
    });

    it('requires the exact validation-derived verdict and current planning version', () => {
        const validated = validatedAssumption();
        const later = appendDecisionEvent(validated, {
            id: 'later-manual-verdict', planningRecordId: validated.id, actor: 'user', type: 'custom_answered',
            answer: 'Proceed for a different reason.', at: 40,
        });
        if (!later.ok) throw new Error(later.reason);
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0, evaluatedAt: 41 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [later.record] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({
            ...shared, planningRecords: [validated], currentSpineVersionId: 'spine-2', currentSpineContentHash: 'same-visible-content',
        }).isReadyToBuild).toBe(false);
    });

    it('makes expired validation historical instead of silently retaining readiness', () => {
        const expires = validatedAssumption({ expiresAt: 50 });
        const shared = { prd, planningRecords: [expires], incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0 };
        expect(derivePlanningReadiness({ ...shared, evaluatedAt: 49 }).isReadyToBuild).toBe(true);
        expect(derivePlanningReadiness({ ...shared, evaluatedAt: 51 })).toMatchObject({
            isReadyToBuild: false,
            nextAction: { kind: 'validate_assumption', planningRecordId: 'validated-assumption' },
        });
    });

    it('keeps low-impact provenance drift visible without turning it into a blocker', () => {
        const lowAssumption = {
            ...record('assumption', 'open'), id: 'low-assumption', materiality: 'low' as const,
            sourceState: 'missing' as const,
        };
        const lowRisk = {
            ...record('risk', 'open'), id: 'low-risk', materiality: 'low' as const,
            sourceState: 'changed' as const,
        };
        const result = derivePlanningReadiness({
            prd, planningRecords: [lowAssumption, lowRisk], incompleteSectionCount: 0,
            hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0,
        });
        expect(result.isReadyToBuild).toBe(true);
        expect(result.changedSourceCount).toBe(0);
        expect(result.nextAction.kind).toBe('commit_plan');
    });

    it('keeps legacy assumptions, material risks, and consequential deferrals visible', () => {
        const legacy = record('assumption', 'open');
        const risk = { ...record('risk', 'open'), materiality: 'normal' as const };
        const deferred = record('decision', 'deferred');
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [legacy] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [risk] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [deferred] }).isReadyToBuild).toBe(false);
    });

    it('fails closed for a material settled status without a durable user verdict event', () => {
        const importedProjection = {
            ...record('decision', 'confirmed'), schemaVersion: 1 as const, materiality: 'high' as const,
            events: [{
                id: 'created-only', planningRecordId: 'decision-1', type: 'created' as const,
                actor: 'user' as const, at: 1,
            }],
        };
        const result = derivePlanningReadiness({
            prd, planningRecords: [importedProjection], incompleteSectionCount: 0,
            hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0,
        });
        expect(result.isReadyToBuild).toBe(false);
        expect(result.nextAction).toMatchObject({ kind: 'resolve_decision', planningRecordId: 'decision-1' });
    });

    it('blocks on unapplied or deferred propagation but allows explicit downstream not-affected reviews', () => {
        const previewId = 'impact-1';
        const proposal = (requiredForVerdictAlignment: boolean) => ({
            id: 'proposal-1',
            target: { kind: 'claim' as const, section: 'Target Users', label: 'Primary user', jsonPath: '$.targetUsers' },
            operation: 'replace' as const,
            proposedSummary: 'Independent creators', proposedValue: ['Independent creators'],
            reason: 'Reflect the user verdict.', confidence: 'definite' as const,
            requiredForVerdictAlignment,
        });
        const alignedRecord = (requiredForVerdictAlignment: boolean, disposition?: 'accepted' | 'rejected' | 'deferred', applied = false): PlanningRecord => ({
            ...record('decision', 'confirmed'),
            materiality: 'high',
            events: [
                { id: 'verdict', planningRecordId: 'decision-1', type: 'custom_answered', actor: 'user', at: 2, answer: 'Independent creators' },
                ...(disposition ? [{
                    id: `review-${disposition}`, planningRecordId: 'decision-1', type: 'alignment_change_reviewed' as const,
                    actor: 'user' as const, at: 3, impactPreviewId: previewId, proposalId: 'proposal-1', disposition,
                }] : []),
                ...(applied ? [{
                    id: 'applied', planningRecordId: 'decision-1', type: 'applied_to_plan' as const, actor: 'user' as const,
                    at: 4, impactPreviewId: previewId, baselineSpineVersionId: 's1', resultingSpineVersionId: 's2',
                }] : []),
            ],
            assessments: [{
                id: 'assessment', projectId: 'p1', planningRecordId: 'decision-1', sourceSpineVersionId: 's1',
                status: 'fresh', evidence: [], inferredAssumptions: [], possibleConflictRecordIds: [], createdAt: 2,
                impactPreview: {
                    id: previewId, projectId: 'p1', planningRecordId: 'decision-1', decisionEventId: 'verdict', status: applied ? 'applied' : 'ready',
                    baseline: { spineVersionId: 's1', spineContentHash: 'hash' }, affectedPrdSections: ['Target Users'],
                    affectedArtifactSlots: [], possibleConflictRecordIds: [], alignmentProposals: [proposal(requiredForVerdictAlignment)], createdAt: 2,
                },
            }],
        });

        expect(planningRecordNeedsAlignment(alignedRecord(true))).toBe(true);
        expect(planningRecordNeedsAlignment(alignedRecord(true, 'accepted'))).toBe(true);
        expect(planningRecordNeedsAlignment(alignedRecord(true, 'accepted', true))).toBe(false);
        expect(planningRecordNeedsAlignment(alignedRecord(false, 'deferred'))).toBe(true);
        expect(planningRecordNeedsAlignment(alignedRecord(false, 'rejected'))).toBe(false);
        expect(planningRecordNeedsAlignment(alignedRecord(true, 'rejected'))).toBe(true);

        const readiness = derivePlanningReadiness({
            prd, planningRecords: [alignedRecord(true, 'accepted')], incompleteSectionCount: 0,
            hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0,
        });
        expect(readiness.isReadyToBuild).toBe(false);
        expect(readiness.nextAction).toMatchObject({ kind: 'align_plan', planningRecordId: 'decision-1' });
    });

    it('treats a material legacy verdict with affected context as unreviewed alignment', () => {
        const legacy: PlanningRecord = {
            ...record('decision', 'confirmed'),
            affectedPrdSections: ['Target Users'],
            events: [{
                id: 'verdict', planningRecordId: 'decision-1', type: 'custom_answered', actor: 'user', at: 2,
                answer: 'Independent creators',
            }],
        };
        expect(planningRecordNeedsAlignment(legacy)).toBe(true);
        expect(planningRecordNeedsAlignment({ ...legacy, materiality: 'low' })).toBe(false);
    });

    it('does not clear consequential findings through deferral or an unverified revision request', () => {
        const issue: ReviewIssue = {
            id: 'i1', projectId: 'p1', reviewId: 'r1', title: 'Missing authorization rule', summary: 'Authorization is undefined.',
            kind: 'risk', findingIds: [], specialistIds: [], relationship: 'standalone', severity: 'high', confidence: 'high',
            implementationImpact: 'resolve_before_build', relatedPlanningRecordIds: [], dispositions: [], status: 'deferred', createdAt: 1, updatedAt: 1,
        };
        expect(reviewIssueNeedsResolutionBeforeBuild(issue, 's1')).toBe(true);
        expect(reviewIssueNeedsResolutionBeforeBuild({
            ...issue,
            status: 'acted',
            dispositions: [{ action: 'request_revision', actor: 'user', at: 2, contextSignature: 'c' }],
        }, 's1')).toBe(true);
        expect(reviewIssueNeedsResolutionBeforeBuild({
            ...issue,
            status: 'acted',
            dispositions: [{ action: 'request_revision', actor: 'user', at: 2, contextSignature: 'c', resultingSpineVersionId: 's1' }],
        }, 's1')).toBe(false);
        expect(reviewIssueNeedsResolutionBeforeBuild({ ...issue, status: 'dismissed' }, 's1')).toBe(false);
    });
});
