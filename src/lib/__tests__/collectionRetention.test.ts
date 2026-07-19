import { describe, expect, it } from 'vitest';
import type {
    ReadinessCommitmentEvent,
    ReadinessReview,
    ReviewIssue,
    ReviewRun,
    SpecialistFinding,
    SpecialistRun,
} from '../../types';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanEvent } from '../planning/downstreamUpdatePlan';
import type {
    DownstreamArtifactUpdateApplication,
    DownstreamArtifactUpdateProposal,
    DownstreamArtifactUpdateReviewEvent,
    DownstreamArtifactUpdateVerification,
    DownstreamArtifactUpdateVerificationEvent,
} from '../planning/downstreamArtifactUpdateProposal';
import {
    DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT,
    READINESS_REVIEW_RETENTION_LIMIT,
    REVIEW_RUN_RETENTION_LIMIT,
    pruneDownstreamCollections,
    pruneReadinessReviews,
    pruneReviewCollections,
} from '../collectionRetention';

const projectId = 'p1';

// --- Adversarial review fixtures -------------------------------------------

const reviewRun = (id: string, overrides: Partial<ReviewRun> = {}): ReviewRun => ({
    id,
    projectId,
    sequenceNumber: 1,
    scope: { kind: 'project' },
    sourceManifest: {
        spineVersionId: 'spine-1',
        spineContentHash: 'spine-hash',
        artifactRefs: [],
        capturedAt: 1,
        contextSignature: 'sig',
    },
    selectedSpecialists: [],
    status: 'complete',
    synthesisStatus: 'complete',
    createdAt: 1,
    ...overrides,
});

const specialistRun = (id: string, reviewId: string): SpecialistRun => ({
    id,
    projectId,
    reviewId,
    specialistId: 'product_scope',
    responsibility: 'Challenge the scope',
    boundaries: [],
    contextRefIds: [],
    status: 'complete',
    attemptCount: 1,
    findingIds: [],
    createdAt: 1,
});

const finding = (id: string, reviewId: string): SpecialistFinding => ({
    id,
    projectId,
    reviewId,
    specialistRunId: `${reviewId}-s`,
    specialistId: 'product_scope',
    kind: 'risk',
    title: 'A risk',
    observation: 'Observed',
    whyItMatters: 'It matters',
    severity: 'medium',
    confidence: 'medium',
    implementationImpact: 'deferrable',
    evidence: [],
    fingerprint: `fp-${id}`,
    grounded: true,
    createdAt: 1,
});

const issue = (id: string, reviewId: string, status: ReviewIssue['status']): ReviewIssue => ({
    id,
    projectId,
    reviewId,
    title: 'An issue',
    summary: 'Summary',
    kind: 'risk',
    findingIds: [],
    specialistIds: ['product_scope'],
    relationship: 'standalone',
    severity: 'medium',
    confidence: 'medium',
    implementationImpact: 'deferrable',
    status,
    dispositions: [],
    relatedPlanningRecordIds: [],
    createdAt: 1,
    updatedAt: 1,
});

const reviewCollections = (runs: ReviewRun[], issues: ReviewIssue[] = []) => ({
    reviewRuns: { [projectId]: runs },
    specialistRuns: { [projectId]: runs.map(run => specialistRun(`${run.id}-s`, run.id)) },
    reviewFindings: { [projectId]: runs.map(run => finding(`${run.id}-f`, run.id)) },
    reviewIssues: { [projectId]: issues },
});

describe('pruneReviewCollections', () => {
    it('returns the identical collections when the run count is within the limit', () => {
        const collections = reviewCollections([reviewRun('r1'), reviewRun('r2')]);
        expect(pruneReviewCollections(collections, projectId)).toBe(collections);
    });

    it('drops the oldest runs beyond the limit and cascades their specialist runs, findings, and issues', () => {
        const runs = Array.from({ length: REVIEW_RUN_RETENTION_LIMIT + 3 }, (_, index) => reviewRun(`r${index}`));
        const issues = runs.map(run => issue(`${run.id}-i`, run.id, 'dismissed'));
        const pruned = pruneReviewCollections(reviewCollections(runs, issues), projectId);
        const keptIds = pruned.reviewRuns[projectId].map(run => run.id);
        expect(keptIds).toEqual(runs.slice(3).map(run => run.id));
        expect(pruned.specialistRuns[projectId].every(run => keptIds.includes(run.reviewId))).toBe(true);
        expect(pruned.reviewFindings[projectId].every(item => keptIds.includes(item.reviewId))).toBe(true);
        expect(pruned.reviewIssues[projectId].every(item => keptIds.includes(item.reviewId))).toBe(true);
        expect(pruned.specialistRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
    });

    it('never prunes a run that still has an open or deferred issue', () => {
        const runs = Array.from({ length: 6 }, (_, index) => reviewRun(`r${index}`));
        const issues = [issue('i-open', 'r0', 'open'), issue('i-deferred', 'r1', 'deferred')];
        const pruned = pruneReviewCollections(reviewCollections(runs, issues), projectId, { limit: 2 });
        const keptIds = pruned.reviewRuns[projectId].map(run => run.id);
        expect(keptIds).toEqual(['r0', 'r1', 'r4', 'r5']);
        expect(pruned.reviewIssues[projectId].map(item => item.id)).toEqual(['i-open', 'i-deferred']);
    });

    it('never prunes an in-flight run or a caller-protected run', () => {
        const runs = [
            reviewRun('r0', { status: 'running', synthesisStatus: 'pending' }),
            reviewRun('r1'),
            reviewRun('r2'),
            reviewRun('r3'),
            reviewRun('r4'),
        ];
        const pruned = pruneReviewCollections(reviewCollections(runs), projectId, {
            limit: 2,
            protectedReviewIds: ['r1'],
        });
        expect(pruned.reviewRuns[projectId].map(run => run.id)).toEqual(['r0', 'r1', 'r3', 'r4']);
    });

    it('keeps unchanged dependent collections referentially identical', () => {
        const runs = Array.from({ length: 4 }, (_, index) => reviewRun(`r${index}`));
        const collections = {
            ...reviewCollections(runs),
            // No findings/issues at all: the maps must come back unchanged.
            reviewFindings: { [projectId]: [] as SpecialistFinding[] },
            reviewIssues: { [projectId]: [] as ReviewIssue[] },
        };
        const pruned = pruneReviewCollections(collections, projectId, { limit: 2 });
        expect(pruned.reviewRuns[projectId]).toHaveLength(2);
        expect(pruned.reviewFindings).toBe(collections.reviewFindings);
        expect(pruned.reviewIssues).toBe(collections.reviewIssues);
    });
});

// --- Readiness fixtures -----------------------------------------------------

const readinessReview = (id: string): ReadinessReview => ({
    id,
    projectId,
    schemaVersion: 1,
    criteriaVersion: 2,
    conclusion: 'not_ready',
    spineVersionId: 'spine-1',
    snapshotHashes: {
        spineIdentity: 'a', spineContent: 'b', planningState: 'c',
        challenge: 'd', alignment: 'e', downstream: 'f', aggregate: `agg-${id}`,
    },
    criteria: [],
    concerns: [],
    caveats: [],
    createdAt: 1,
    integrityHash: `hash-${id}`,
});

const commitmentEvent = (id: string, reviewId: string): ReadinessCommitmentEvent => ({
    eventSchemaVersion: 1,
    eventIntegrityHash: `event-${id}`,
    id,
    projectId,
    reviewId,
    actor: 'user',
    at: 1,
    spineVersionId: 'spine-1',
    snapshotHash: 'snap',
    integrityHash: `hash-${reviewId}`,
    aggregateHash: `agg-${reviewId}`,
    type: 'commit_authorized',
    acceptedConcernIds: [],
    rationale: 'Committed with full knowledge of the open concerns.',
});

describe('pruneReadinessReviews', () => {
    it('returns the identical map when within the limit', () => {
        const collections = {
            readinessReviews: { [projectId]: [readinessReview('rr1')] },
            readinessCommitmentEvents: {},
        };
        expect(pruneReadinessReviews(collections, projectId)).toBe(collections.readinessReviews);
    });

    it('drops the oldest reviews beyond the limit', () => {
        const reviews = Array.from(
            { length: READINESS_REVIEW_RETENTION_LIMIT + 2 },
            (_, index) => readinessReview(`rr${index}`),
        );
        const pruned = pruneReadinessReviews({
            readinessReviews: { [projectId]: reviews },
            readinessCommitmentEvents: {},
        }, projectId);
        expect(pruned[projectId].map(review => review.id)).toEqual(reviews.slice(2).map(review => review.id));
    });

    it('always keeps a review referenced by any commitment event', () => {
        const reviews = Array.from({ length: 5 }, (_, index) => readinessReview(`rr${index}`));
        const pruned = pruneReadinessReviews({
            readinessReviews: { [projectId]: reviews },
            readinessCommitmentEvents: { [projectId]: [commitmentEvent('c1', 'rr0')] },
        }, projectId, { limit: 2 });
        expect(pruned[projectId].map(review => review.id)).toEqual(['rr0', 'rr3', 'rr4']);
    });
});

// --- Downstream update-plan fixtures ----------------------------------------

const plan = (id: string, artifactId: string): DownstreamUpdatePlan => ({
    schemaVersion: 1,
    id,
    projectId,
    authoredBy: 'synapse',
    source: {
        kind: 'planning_change',
        summary: 'A confirmed decision changed the plan.',
        targetSpineVersionId: 'spine-1',
        targetSpineContentHash: 'spine-hash',
        planningContextHash: 'planning-hash',
        confirmed: true,
    },
    artifact: {
        artifactId,
        artifactVersionId: `${artifactId}-v1`,
        artifactContentHash: 'content-hash',
        slot: 'screen_inventory',
        title: 'Screens',
    },
    items: [],
    preservedArtifactSummary: 'Everything else is preserved.',
    createdAt: 1,
    integrityHash: `plan-hash-${id}`,
});

const planEvent = (id: string, planId: string): DownstreamUpdatePlanEvent => ({
    schemaVersion: 1,
    id,
    projectId,
    planId,
    itemId: 'item-1',
    actor: 'user',
    at: 1,
    expectedPlanIntegrityHash: `plan-hash-${planId}`,
    type: 'priority_changed',
    priority: 1,
    integrityHash: `event-hash-${id}`,
});

const proposal = (id: string, planId: string): DownstreamArtifactUpdateProposal => ({
    schemaVersion: 1,
    id,
    projectId,
    authoredBy: 'synapse',
    updatePlanBinding: {
        planId,
        planIntegrityHash: `plan-hash-${planId}`,
        itemId: 'item-1',
        itemIntegrityHash: 'item-hash',
    },
    source: plan(planId, 'a1').source,
    artifact: {
        artifactId: 'a1',
        artifactVersionId: 'a1-v1',
        artifactContentHash: 'content-hash',
        slot: 'screen_inventory',
        title: 'Screens',
    },
    region: { kind: 'screen', screenId: 's1', screenName: 'Screen', aspect: 'state', aspectId: 'st1', label: 'State' },
    regionKey: 'region-key',
    currentRegionContentHash: 'region-hash',
    currentRegionSnapshot: 'snapshot',
    currentRegionSnapshotTruncated: false,
    operation: 'remove',
    proposedContent: null,
    evidence: [],
    reasoning: 'The region contradicts the plan.',
    certainty: 'definite',
    preservedScope: [],
    preservedScopeHash: 'scope-hash',
    preservedRegionBindings: [],
    generator: { provider: 'openai', model: 'reasoner', promptHash: 'prompt', reasoningVersion: 'v1' },
    createdAt: 1,
    integrityHash: `proposal-hash-${id}`,
});

const reviewEvent = (id: string, proposalId: string): DownstreamArtifactUpdateReviewEvent => ({
    schemaVersion: 1,
    id,
    projectId,
    proposalId,
    actor: 'user',
    at: 1,
    expectedProposalIntegrityHash: `proposal-hash-${proposalId}`,
    expectedPlanIntegrityHash: 'plan-hash',
    expectedItemIntegrityHash: 'item-hash',
    expectedRegionContentHash: 'region-hash',
    action: 'accepted',
    integrityHash: `review-hash-${id}`,
});

const application = (id: string, proposalId: string): DownstreamArtifactUpdateApplication => ({
    schemaVersion: 1,
    id,
    projectId,
    proposalId,
    proposalIntegrityHash: `proposal-hash-${proposalId}`,
    authorizedByReviewEventId: 'rev-1',
    authorizedByReviewEventIntegrityHash: 'review-hash',
    actor: 'system',
    initiatedBy: 'user',
    effectiveOperation: 'remove',
    effectiveContentHash: null,
    expectedArtifactVersionId: 'a1-v1',
    expectedArtifactContentHash: 'content-hash',
    expectedRegionContentHash: 'region-hash',
    resultingArtifactVersionId: 'a1-v2',
    resultingArtifactContentHash: 'content-hash-2',
    resultingRegionContentHash: 'region-hash-2',
    appliedAt: 2,
    integrityHash: `application-hash-${id}`,
});

const verification = (
    id: string,
    binding: { subjectPlanId?: string; proposalId?: string },
): DownstreamArtifactUpdateVerification => ({
    schemaVersion: 1,
    id,
    projectId,
    ...(binding.proposalId ? { proposalId: binding.proposalId } : {}),
    ...(binding.subjectPlanId ? {
        subject: {
            kind: 'manual_update' as const,
            planId: binding.subjectPlanId,
            planIntegrityHash: `plan-hash-${binding.subjectPlanId}`,
            itemId: 'item-1',
            itemIntegrityHash: 'item-hash',
            sourceSpineVersionId: 'spine-1',
            sourceSpineContentHash: 'spine-hash',
            planningContextHash: 'planning-hash',
            artifactId: 'a1',
            baselineArtifactVersionId: 'a1-v1',
            baselineArtifactContentHash: 'content-hash',
            targetArtifactVersionId: 'a1-v2',
            targetArtifactContentHash: 'content-hash-2',
        },
    } : {}),
    authoredBy: 'synapse',
    result: 'aligned',
    evidence: [],
    reasoning: 'Deterministic verification.',
    verifiedArtifactVersionId: 'a1-v2',
    verifiedArtifactContentHash: 'content-hash-2',
    verifiedRegionContentHash: 'region-hash-2',
    generator: { provider: 'openai', model: 'reasoner', promptHash: 'prompt', reasoningVersion: 'v1' },
    createdAt: 2,
    integrityHash: `verification-hash-${id}`,
});

const verificationEvent = (id: string, verificationId: string): DownstreamArtifactUpdateVerificationEvent => ({
    schemaVersion: 1,
    id,
    projectId,
    verificationId,
    actor: 'user',
    action: 'confirmed',
    expectedVerificationIntegrityHash: `verification-hash-${verificationId}`,
    at: 3,
    integrityHash: `verification-event-hash-${id}`,
});

describe('pruneDownstreamCollections', () => {
    const emptyDependents = {
        downstreamUpdatePlanEvents: {},
        downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {},
        downstreamArtifactUpdateVerificationEvents: {},
    };

    it('returns the identical collections when the total plan count is within the per-artifact limit', () => {
        const collections = {
            downstreamUpdatePlans: { [projectId]: [plan('p1', 'a1'), plan('p2', 'a2')] },
            ...emptyDependents,
        };
        expect(pruneDownstreamCollections(collections, projectId)).toBe(collections);
    });

    it('caps plans per artifact lineage, keeping each artifact\'s newest plans', () => {
        const plans = [
            ...Array.from({ length: DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT + 2 }, (_, index) => plan(`a1-p${index}`, 'a1')),
            plan('a2-p0', 'a2'),
        ];
        const pruned = pruneDownstreamCollections({
            downstreamUpdatePlans: { [projectId]: plans },
            ...emptyDependents,
        }, projectId);
        const keptIds = pruned.downstreamUpdatePlans[projectId].map(item => item.id);
        expect(keptIds).not.toContain('a1-p0');
        expect(keptIds).not.toContain('a1-p1');
        expect(keptIds).toContain(`a1-p${DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT + 1}`);
        expect(keptIds).toContain('a2-p0');
    });

    it('cascades every dependent record of a pruned plan and keeps the retained chain intact', () => {
        const plans = [plan('old', 'a1'), plan('mid', 'a1'), plan('new', 'a1')];
        const collections = {
            downstreamUpdatePlans: { [projectId]: plans },
            downstreamUpdatePlanEvents: { [projectId]: [planEvent('e-old', 'old'), planEvent('e-new', 'new')] },
            downstreamArtifactUpdateProposals: { [projectId]: [proposal('prop-old', 'old'), proposal('prop-new', 'new')] },
            downstreamArtifactUpdateReviewEvents: { [projectId]: [reviewEvent('rev-old', 'prop-old'), reviewEvent('rev-new', 'prop-new')] },
            downstreamArtifactUpdateApplications: { [projectId]: [application('app-old', 'prop-old'), application('app-new', 'prop-new')] },
            downstreamArtifactUpdateVerifications: {
                [projectId]: [
                    verification('ver-old-subject', { subjectPlanId: 'old' }),
                    verification('ver-old-legacy', { proposalId: 'prop-old' }),
                    verification('ver-new', { subjectPlanId: 'new' }),
                    verification('ver-unbound', {}),
                ],
            },
            downstreamArtifactUpdateVerificationEvents: {
                [projectId]: [verificationEvent('ve-old', 'ver-old-subject'), verificationEvent('ve-new', 'ver-new')],
            },
        };
        const pruned = pruneDownstreamCollections(collections, projectId, { limitPerArtifact: 2 });
        expect(pruned.downstreamUpdatePlans[projectId].map(item => item.id)).toEqual(['mid', 'new']);
        expect(pruned.downstreamUpdatePlanEvents[projectId].map(item => item.id)).toEqual(['e-new']);
        expect(pruned.downstreamArtifactUpdateProposals[projectId].map(item => item.id)).toEqual(['prop-new']);
        expect(pruned.downstreamArtifactUpdateReviewEvents[projectId].map(item => item.id)).toEqual(['rev-new']);
        expect(pruned.downstreamArtifactUpdateApplications[projectId].map(item => item.id)).toEqual(['app-new']);
        // Subject-bound and legacy proposal-bound verifications cascade; a
        // verification with no resolvable binding is kept conservatively.
        expect(pruned.downstreamArtifactUpdateVerifications[projectId].map(item => item.id)).toEqual(['ver-new', 'ver-unbound']);
        expect(pruned.downstreamArtifactUpdateVerificationEvents[projectId].map(item => item.id)).toEqual(['ve-new']);
    });
});
