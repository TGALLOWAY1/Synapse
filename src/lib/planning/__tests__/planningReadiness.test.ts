import { describe, expect, it } from 'vitest';
import type { PlanningRecord, ReviewIssue, StructuredPRD } from '../../../types';
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

    it('keeps legacy assumptions, material risks, and consequential deferrals visible', () => {
        const legacy = record('assumption', 'open');
        const risk = { ...record('risk', 'open'), materiality: 'normal' as const };
        const deferred = record('decision', 'deferred');
        const shared = { prd, incompleteSectionCount: 0, hasCurrentChallenge: true, blockingReviewIssueCount: 0, generatedOutputCount: 0, staleOutputCount: 0 };
        expect(derivePlanningReadiness({ ...shared, planningRecords: [legacy] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [risk] }).isReadyToBuild).toBe(false);
        expect(derivePlanningReadiness({ ...shared, planningRecords: [deferred] }).isReadyToBuild).toBe(false);
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
