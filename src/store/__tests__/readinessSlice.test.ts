import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlanningRecord, StructuredPRD } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import { buildReviewContextManifest } from '../../lib/review/manifest';
import {
    appendAssumptionValidationEvent,
    appendDecisionEvent,
    assumptionEvidenceSetHash,
    assumptionStatementHash,
    assumptionValidationDecisionEvent,
    compareReadinessReviewCurrentness,
    projectAssumptionValidation,
    sealAssumptionEvidence,
    sealAssumptionValidationEvent,
    sealAssumptionValidationPlan,
} from '../../lib/planning';
import { useProjectStore } from '../projectStore';

const projectId = 'readiness-project';
const spineId = 'spine-1';
const content = '# Exact current plan\nA durable implementation foundation.';

const prd: StructuredPRD = {
    vision: 'Help product teams avoid implementing the wrong plan.',
    coreProblem: 'Teams begin implementation while consequential planning uncertainty remains hidden.',
    targetUsers: ['Product teams preparing an implementation-ready plan.'],
    architecture: 'A versioned planning workspace.',
    risks: ['Implementation may rely on an unvalidated operating assumption.'],
    successMetrics: [{ name: 'Confident implementation starts' }],
    features: [{
        id: 'f1', name: 'Readiness checkpoint', description: 'Explain the exact planning condition.',
        userValue: 'Know why this version is safe or unsafe to implement.', complexity: 'medium',
        tier: 'mvp', confirmed: true,
    }],
};

const assumption = (): PlanningRecord => ({
    id: 'assumption-1', projectId, type: 'assumption', status: 'confirmed', title: 'Users will revisit warnings',
    statement: 'Users will revisit deferred operational warnings during implementation.', materiality: 'high',
    evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 2,
    events: [{
        id: 'assumption-answer', planningRecordId: 'assumption-1', type: 'custom_answered', actor: 'user',
        at: 2, answer: 'Proceed with the premise for now.',
    }],
});

const expiringValidatedAssumption = (expiresAt: number): PlanningRecord => {
    let current: PlanningRecord = {
        ...assumption(), status: 'open', events: [],
    };
    const plan = sealAssumptionValidationPlan({
        id: 'plan', question: 'Will users revisit operational warnings?',
        method: { kind: 'usability_observation', label: 'Observed planning session' }, supportSignals: ['User revisits warning'],
        contradictionSignals: ['Warning is ignored'], inconclusiveConditions: [], limitations: ['One team'],
        expiresAt, authoredBy: 'user', createdAt: 1_010,
    });
    const planned = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
        id: 'plan-event', planningRecordId: current.id, actor: 'user', type: 'validation_plan_recorded', at: 1_010,
        assumptionStatementHash: assumptionStatementHash(current), plan, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
    }));
    if (!planned.ok) throw new Error(planned.reason);
    current = planned.record;
    const evidence = sealAssumptionEvidence({
        id: 'evidence', planningRecordId: current.id, sourceType: 'usability_observation', source: 'Planning session',
        sourceIdentity: 'session-1', observedAt: 1_019, recordedAt: 1_020,
        observation: 'The user revisited the warning before committing.', validationQuestion: plan.question,
        limitations: ['One team'], character: 'direct', relation: 'supports', assumptionStatementHash: assumptionStatementHash(current),
        validationPlanHash: plan.contentHash, authoredBy: 'user',
    });
    const evidenced = appendAssumptionValidationEvent(current, sealAssumptionValidationEvent({
        id: 'evidence-event', planningRecordId: current.id, actor: 'user', type: 'validation_evidence_recorded', at: 1_020,
        assumptionStatementHash: assumptionStatementHash(current), evidence, expectedEvidenceSetHash: assumptionEvidenceSetHash([]),
    }));
    if (!evidenced.ok) throw new Error(evidenced.reason);
    current = evidenced.record;
    const projection = projectAssumptionValidation(current, 1_030);
    const outcome = sealAssumptionValidationEvent({
        id: 'outcome', planningRecordId: current.id, actor: 'user', type: 'validation_outcome_recorded', at: 1_030,
        assumptionStatementHash: assumptionStatementHash(current), conclusion: 'supported',
        expectedValidationPlanHash: projection.currentPlan!.contentHash,
        expectedEvidenceSetHash: assumptionEvidenceSetHash(projection.activeEvidence),
    });
    const concluded = appendAssumptionValidationEvent(current, outcome);
    if (!concluded.ok) throw new Error(concluded.reason);
    const verdict = appendDecisionEvent(concluded.record, assumptionValidationDecisionEvent(current, outcome)!);
    if (!verdict.ok) throw new Error(verdict.reason);
    return verdict.record;
};

const challengeManifest = buildReviewContextManifest({
    projectId,
    projectName: 'Readiness project',
    spine: { versionId: spineId, content, structuredPRD: prd },
    artifacts: [],
    safetyBoundaries: [],
});
const challengeContextSignature = challengeManifest.contextSignature;

beforeEach(() => {
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Readiness project', createdAt: 1 } },
        spineVersions: { [projectId]: [{
            id: spineId, projectId, promptText: 'Plan it', responseText: content, createdAt: 1,
            isLatest: true, isFinal: false, structuredPRD: prd, generationPhase: 'complete',
        }] },
        historyEvents: { [projectId]: [] },
        artifacts: { [projectId]: [] }, artifactVersions: { [projectId]: [] },
        planningRecords: { [projectId]: [] },
        reviewRuns: { [projectId]: [{
            id: 'review-1', projectId, sequenceNumber: 1, scope: { kind: 'project' },
            sourceManifest: {
                spineVersionId: spineId, spineContentHash: hashReviewValue(content), artifactRefs: [],
                capturedAt: 3, contextSignature: challengeContextSignature,
            },
            selectedSpecialists: [{ specialistId: 'product_scope', label: 'Product & Scope', reason: 'Required.' }],
            requiredSpecialistIds: ['product_scope'],
            status: 'complete', synthesisStatus: 'complete', createdAt: 3, completedAt: 4,
        }] },
        specialistRuns: { [projectId]: [{
            id: 'specialist-1', projectId, reviewId: 'review-1', specialistId: 'product_scope',
            responsibility: 'Challenge scope and assumptions.', boundaries: [], contextRefIds: [`spine:${spineId}`],
            status: 'complete', attemptCount: 1, findingIds: [],
            coverageSummary: 'Reviewed product scope and material assumptions.',
            resolvedAreas: ['The problem, primary user, outcome, and first-release scope are explicit.'],
            coverageChecks: [
                'problem', 'primary_user', 'intended_outcome', 'first_release_scope', 'material_assumptions',
            ].map(area => ({
                area: area as 'problem' | 'primary_user' | 'intended_outcome' | 'first_release_scope' | 'material_assumptions',
                conclusion: `The ${area.replaceAll('_', ' ')} is explicit in this exact plan version.`,
                evidence: [(() => {
                    const paths = {
                        problem: 'prd.coreProblem', primary_user: 'prd.targetUsers', intended_outcome: 'prd.successMetrics',
                        first_release_scope: 'prd.features.f1', material_assumptions: 'prd.risks',
                    } as const;
                    const locator = challengeManifest.locators.find(item => item.path === paths[area as keyof typeof paths])!;
                    return {
                        id: locator.id, sourceType: 'spine' as const, sourceId: spineId, sourceVersionId: spineId,
                        locator: { section: locator.label, jsonPath: locator.path },
                        excerpt: locator.excerpt, excerptHash: locator.excerptHash, verified: true,
                    };
                })()],
            })),
            validation: { valid: true, unsupportedEvidenceIds: [], warnings: [] }, createdAt: 3, completedAt: 4,
        }] },
        reviewIssues: { [projectId]: [] }, reviewFindings: { [projectId]: [] },
        readinessReviews: { [projectId]: [] }, readinessCommitmentEvents: { [projectId]: [] },
    });
});

describe('durable readiness authority boundary', () => {
    it('commits only through an exact current reviewed snapshot and can reopen append-only', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        expect(created.status).toBe('created');
        if (created.status !== 'created') return;
        expect(created.review.conclusion).toBe('ready_to_build');

        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        expect(authorized.status).toBe('authorized');
        if (authorized.status !== 'authorized') return;

        const committed = useProjectStore.getState().commitReadinessReview(
            projectId, created.reviewId, authorized.authorizationEventId,
        );
        expect(committed.status).toBe('committed');
        if (committed.status !== 'committed') return;
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(true);

        const reopened = useProjectStore.getState().reopenReadinessCommitment(projectId, committed.commitmentEventId, 'New evidence arrived.');
        expect(reopened.status).toBe('reopened');
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(false);
        expect(useProjectStore.getState().readinessCommitmentEvents[projectId].map(event => event.type))
            .toEqual(['commit_authorized', 'plan_committed', 'plan_reopened']);

        expect(useProjectStore.getState().commitReadinessReview(
            projectId, created.reviewId, authorized.authorizationEventId,
        )).toMatchObject({ status: 'rejected', reason: 'authorization_consumed' });

        const reauthorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        expect(reauthorized.status).toBe('authorized');
        if (reauthorized.status !== 'authorized') return;
        expect(useProjectStore.getState().commitReadinessReview(
            projectId, created.reviewId, reauthorized.authorizationEventId,
        ).status).toBe('committed');
    });

    it('preserves not-ready evidence and requires exact accepted concerns, rationale, and containment', () => {
        useProjectStore.setState({ planningRecords: { [projectId]: [assumption()] } });
        const created = useProjectStore.getState().createReadinessReview(projectId);
        expect(created.status).toBe('created');
        if (created.status !== 'created') return;
        expect(created.review.conclusion).toBe('not_ready');
        const acceptedConcernIds = created.review.concerns.map(item => item.id);

        expect(useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds,
        })).toMatchObject({ status: 'rejected', reason: 'rationale_required' });

        expect(useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds,
            rationale: 'We need to begin a bounded implementation learning step.',
        })).toMatchObject({ status: 'rejected', reason: 'containment_required' });

        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds,
            rationale: 'We need to begin a bounded implementation learning step.',
            containmentPlan: 'Limit implementation to a reversible prototype and validate the premise before expansion.',
        });
        expect(authorized.status).toBe('authorized');
        expect(useProjectStore.getState().readinessReviews[projectId][0].conclusion).toBe('not_ready');
        expect(useProjectStore.getState().planningRecords[projectId][0].status).toBe('confirmed');
    });

    it('rejects commitment after planning authority changes between authorization and commit', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        if (authorized.status !== 'authorized') throw new Error('expected authorization');
        useProjectStore.setState({ planningRecords: { [projectId]: [assumption()] } });
        expect(useProjectStore.getState().commitReadinessReview(projectId, created.reviewId, authorized.authorizationEventId))
            .toMatchObject({ status: 'rejected', reason: 'stale' });
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(false);
    });

    it('rejects commitment when the safety boundary becomes blocked after authorization', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        if (authorized.status !== 'authorized') throw new Error('expected authorization');
        useProjectStore.setState(state => ({
            spineVersions: { [projectId]: state.spineVersions[projectId].map(spine => ({
                ...spine,
                safetyReview: {
                    classification: 'disallowed', status: 'blocked', detectedConcerns: ['unsafe'],
                    userFacingReason: 'This plan cannot be used.', safeAlternatives: [], reviewedAt: 10,
                },
            })) },
        }));
        expect(useProjectStore.getState().commitReadinessReview(projectId, created.reviewId, authorized.authorizationEventId))
            .toMatchObject({ status: 'rejected', reason: 'safety_blocked' });
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(false);
    });

    it('does not let the legacy finality toggle reopen a durable readiness commitment', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        if (authorized.status !== 'authorized') throw new Error('expected authorization');
        expect(useProjectStore.getState().commitReadinessReview(projectId, created.reviewId, authorized.authorizationEventId).status)
            .toBe('committed');

        useProjectStore.getState().markSpineFinal(projectId, spineId, false);
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(true);
    });

    it('rejects tampered reviews and non-user authorization records', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        useProjectStore.setState(state => ({
            readinessReviews: {
                ...state.readinessReviews,
                [projectId]: [{ ...created.review, conclusion: 'not_ready' }],
            },
        }));
        expect(useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        })).toMatchObject({ status: 'rejected', reason: 'tampered' });
    });

    it('cannot reopen authority from a review whose persisted payload was tampered', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        });
        if (authorized.status !== 'authorized') throw new Error('expected authorization');
        const committed = useProjectStore.getState().commitReadinessReview(
            projectId, created.reviewId, authorized.authorizationEventId,
        );
        if (committed.status !== 'committed') throw new Error('expected commitment');
        useProjectStore.setState(state => ({
            readinessReviews: {
                ...state.readinessReviews,
                [projectId]: [{ ...created.review, conclusion: 'not_ready' }],
            },
        }));

        expect(useProjectStore.getState().reopenReadinessCommitment(projectId, committed.commitmentEventId))
            .toMatchObject({ status: 'rejected', reason: 'tampered' });
        expect(useProjectStore.getState().spineVersions[projectId][0].isFinal).toBe(true);
    });

    it('does not silently reuse a review for identical text on a different planning spine', () => {
        const created = useProjectStore.getState().createReadinessReview(projectId);
        if (created.status !== 'created') throw new Error('expected review');
        useProjectStore.setState(state => ({
            spineVersions: { [projectId]: [
                { ...state.spineVersions[projectId][0], isLatest: false },
                { ...state.spineVersions[projectId][0], id: 'spine-2', isLatest: true, isFinal: false, createdAt: 10 },
            ] },
        }));
        expect(useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
            expectedIntegrityHash: created.review.integrityHash,
            expectedAggregateHash: created.review.snapshotHashes.aggregate,
            acceptedConcernIds: [],
        })).toMatchObject({ status: 'rejected', reason: 'stale' });
    });

    it('rejects authorization and commitment after validation expires without a record mutation', () => {
        vi.useFakeTimers();
        try {
            vi.setSystemTime(1_040);
            useProjectStore.setState({ planningRecords: { [projectId]: [expiringValidatedAssumption(1_050)] } });
            const created = useProjectStore.getState().createReadinessReview(projectId);
            if (created.status !== 'created') throw new Error('expected review');
            expect(created.review.conclusion).toBe('ready_to_build');

            const authorized = useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
                expectedIntegrityHash: created.review.integrityHash,
                expectedAggregateHash: created.review.snapshotHashes.aggregate,
                acceptedConcernIds: [],
            });
            if (authorized.status !== 'authorized') throw new Error('expected authorization');

            vi.setSystemTime(1_051);
            expect(useProjectStore.getState().authorizeReadinessCommitment(projectId, created.reviewId, {
                expectedIntegrityHash: created.review.integrityHash,
                expectedAggregateHash: created.review.snapshotHashes.aggregate,
                acceptedConcernIds: [],
            })).toMatchObject({ status: 'rejected', reason: 'stale' });
            expect(useProjectStore.getState().commitReadinessReview(
                projectId, created.reviewId, authorized.authorizationEventId,
            )).toMatchObject({ status: 'rejected', reason: 'stale' });

            const state = useProjectStore.getState();
            const currentInput = {
                projectId,
                spine: { versionId: spineId, content, structuredPRD: prd, incompleteSectionCount: 0, isCommitted: false },
                planningRecords: state.planningRecords[projectId],
                reviewRuns: state.reviewRuns[projectId], specialistRuns: state.specialistRuns[projectId],
                reviewIssues: state.reviewIssues[projectId], reviewFindings: state.reviewFindings[projectId],
                outputAlignment: { outputs: [], alignedCount: 0, possiblyAffectedCount: 0, staleCount: 0, blockingCount: 0 },
                currentChallengeContextSignature: challengeContextSignature, createdAt: 1_051,
            };
            expect(compareReadinessReviewCurrentness(created.review, currentInput)).toMatchObject({
                current: false, historical: true, reasons: expect.arrayContaining(['planning_state_changed']),
            });
        } finally {
            vi.useRealTimers();
        }
    });
});
