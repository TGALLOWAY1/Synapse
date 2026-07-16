import type { StateCreator } from 'zustand';
import { v4 as uuidv4 } from 'uuid';
import type { ArtifactVersion, ReadinessCommitmentEvent } from '../../types';
import type { ProjectState } from '../types';
import { hashReviewValue } from '../../lib/review/hash';
import {
    compareReadinessReviewCurrentness,
    deriveReadinessReview,
    validateReadinessReviewIntegrity,
    type ReadinessReviewInput,
} from '../../lib/planning/readinessReview';
import { deriveProjectOutputAlignment } from '../../lib/planning/outputAlignment';
import {
    buildDownstreamUpdatePlanCurrentContext,
    deriveDownstreamUpdatePlanSummary,
} from '../../lib/planning/downstreamUpdatePlan';
import {
    deriveVerifiedDownstreamUpdatePlanSummary,
    projectDownstreamArtifactUpdateVerifications,
    reconcileProjectOutputAlignment,
} from '../../lib/planning/downstreamArtifactUpdateVerification';
import { buildReviewContextManifest } from '../../lib/review/manifest';
import {
    deriveReadinessCommitmentState,
    readinessAuthorizationMatchesReview,
    readinessEventMatchesReview,
    readinessReviewSnapshotHash,
    sealReadinessCommitmentEvent,
} from '../../lib/planning/readinessCommitment';

export type ReadinessSlice = Pick<ProjectState,
    | 'readinessReviews'
    | 'readinessCommitmentEvents'
    | 'createReadinessReview'
    | 'authorizeReadinessCommitment'
    | 'commitReadinessReview'
    | 'reopenReadinessCommitment'
>;

const meaningful = (value?: string): boolean => !!value && value.trim().length >= 20;

function preferredVersion(
    artifactId: string,
    currentVersionId: string | null | undefined,
    versions: ArtifactVersion[],
): ArtifactVersion | undefined {
    if (currentVersionId) {
        const current = versions.find(version => version.id === currentVersionId);
        if (current) return current;
    }
    return versions.find(version => version.artifactId === artifactId && version.isPreferred);
}

export function buildReadinessReviewInputFromState(
    state: ProjectState,
    projectId: string,
    createdAt?: number,
): ReadinessReviewInput | undefined {
    const spine = (state.spineVersions[projectId] ?? []).find(item => item.isLatest);
    if (!spine) return undefined;
    const artifacts = state.artifacts[projectId] ?? [];
    const versions = state.artifactVersions[projectId] ?? [];
    const rawOutputAlignment = deriveProjectOutputAlignment({
        artifacts,
        artifactVersions: versions,
        spineVersions: state.spineVersions[projectId] ?? [],
        job: state.jobs[projectId],
    });
    const planContext = buildDownstreamUpdatePlanCurrentContext({
            spineVersions: state.spineVersions[projectId] ?? [],
            planningRecords: state.planningRecords[projectId] ?? [],
            artifacts,
            artifactVersions: versions,
        });
    const plans = state.downstreamUpdatePlans[projectId] ?? [];
    const planEvents = state.downstreamUpdatePlanEvents[projectId] ?? [];
    const verificationProjection = projectDownstreamArtifactUpdateVerifications({
        plans,
        context: planContext,
        artifacts,
        artifactVersions: versions,
        verifications: state.downstreamArtifactUpdateVerifications[projectId] ?? [],
        verificationEvents: state.downstreamArtifactUpdateVerificationEvents[projectId] ?? [],
    });
    const outputAlignment = reconcileProjectOutputAlignment(rawOutputAlignment, verificationProjection);
    const downstreamUpdatePlanSummary = deriveVerifiedDownstreamUpdatePlanSummary({
        base: deriveDownstreamUpdatePlanSummary({
            plans,
            events: planEvents,
            context: planContext,
        }),
        plans,
        events: planEvents,
        context: planContext,
        projections: verificationProjection,
    });
    const currentArtifactRefs = artifacts
        .filter(artifact => artifact.status !== 'archived')
        .flatMap(artifact => {
            const version = preferredVersion(artifact.id, artifact.currentVersionId, versions);
            return version ? [{
                artifactId: artifact.id,
                artifactVersionId: version.id,
                contentHash: hashReviewValue(version.content),
            }] : [];
        });
    const project = state.projects[projectId];
    const preferredReviewArtifacts = artifacts.flatMap(artifact => {
        if (artifact.type !== 'core_artifact' || !artifact.subtype || !artifact.currentVersionId) return [];
        const version = versions.find(candidate => candidate.id === artifact.currentVersionId);
        return version ? [{
            artifactId: artifact.id,
            versionId: version.id,
            subtype: artifact.subtype,
            title: artifact.title,
            content: version.content,
        }] : [];
    });
    const currentChallengeContextSignature = project && spine.structuredPRD
        ? buildReviewContextManifest({
            projectId,
            projectName: project.name,
            platform: project.platform,
            productCategory: project.productCategory,
            spine: {
                versionId: spine.id,
                schemaVersion: spine.prdVersion,
                content: spine.responseText,
                structuredPRD: spine.structuredPRD,
                canonicalSpine: spine.canonicalSpine,
            },
            artifacts: preferredReviewArtifacts,
            safetyBoundaries: spine.safetyReview?.detectedConcerns ?? [],
        }).contextSignature
        : undefined;
    return {
        projectId,
        spine: {
            versionId: spine.id,
            content: spine.responseText,
            structuredPRD: spine.structuredPRD,
            incompleteSectionCount: spine.generationMeta?.failedSections?.length ?? 0,
            isCommitted: spine.isFinal,
            safetyReview: spine.safetyReview && {
                status: spine.safetyReview.status,
                classification: spine.safetyReview.classification,
                detectedConcerns: spine.safetyReview.detectedConcerns,
                reviewedAt: spine.safetyReview.reviewedAt,
            },
        },
        planningRecords: state.planningRecords[projectId] ?? [],
        reviewRuns: state.reviewRuns[projectId] ?? [],
        specialistRuns: state.specialistRuns[projectId] ?? [],
        reviewFindings: state.reviewFindings[projectId] ?? [],
        reviewIssues: state.reviewIssues[projectId] ?? [],
        outputAlignment,
        downstreamUpdatePlanSummary,
        currentArtifactRefs,
        currentChallengeContextSignature,
        createdAt,
    };
}

const bindingMatches = readinessEventMatchesReview;

export const createReadinessSlice: StateCreator<ProjectState, [], [], ReadinessSlice> = (set) => ({
    readinessReviews: {},
    readinessCommitmentEvents: {},

    createReadinessReview: (projectId) => {
        let result: ReturnType<ProjectState['createReadinessReview']> = { status: 'rejected', reason: 'project_not_found' };
        set((state) => {
            const project = state.projects[projectId];
            const latestSpine = (state.spineVersions[projectId] ?? []).find(item => item.isLatest);
            if (!project || !latestSpine) return state;
            if (latestSpine.safetyReview?.status === 'blocked') {
                result = { status: 'rejected', reason: 'safety_blocked' };
                return state;
            }
            const input = buildReadinessReviewInputFromState(state, projectId, Date.now());
            if (!input) return state;
            const review = deriveReadinessReview(input);
            const existing = (state.readinessReviews[projectId] ?? []).find(item => (
                item.snapshotHashes.aggregate === review.snapshotHashes.aggregate
                && validateReadinessReviewIntegrity(item)
            ));
            if (existing) {
                result = { status: 'created', reviewId: existing.id, review: existing };
                return state;
            }
            result = { status: 'created', reviewId: review.id, review };
            return {
                readinessReviews: {
                    ...state.readinessReviews,
                    [projectId]: [...(state.readinessReviews[projectId] ?? []), review],
                },
                historyEvents: {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] ?? []), {
                        id: uuidv4(), projectId, spineVersionId: review.spineVersionId,
                        readinessReviewId: review.id,
                        type: 'ReadinessReviewed',
                        description: review.conclusion === 'ready_to_build'
                            ? 'Readiness checkpoint found this plan ready to build'
                            : 'Readiness checkpoint recorded open planning concerns',
                        createdAt: review.createdAt,
                    }],
                },
            };
        });
        return result;
    },

    authorizeReadinessCommitment: (projectId, reviewId, input) => {
        let result: ReturnType<ProjectState['authorizeReadinessCommitment']> = { status: 'rejected', reason: 'review_not_found' };
        set((state) => {
            const review = (state.readinessReviews[projectId] ?? []).find(item => item.id === reviewId);
            if (!review) return state;
            if (!validateReadinessReviewIntegrity(review)) {
                result = { status: 'rejected', reason: 'tampered' };
                return state;
            }
            if (review.integrityHash !== input.expectedIntegrityHash
                || review.snapshotHashes.aggregate !== input.expectedAggregateHash) {
                result = { status: 'rejected', reason: 'hash_mismatch' };
                return state;
            }
            const currentInput = buildReadinessReviewInputFromState(state, projectId, Date.now());
            if (!currentInput || !compareReadinessReviewCurrentness(review, currentInput).current) {
                result = { status: 'rejected', reason: 'stale' };
                return state;
            }
            const spine = (state.spineVersions[projectId] ?? []).find(item => item.id === review.spineVersionId && item.isLatest);
            if (spine?.safetyReview?.status === 'blocked') {
                result = { status: 'rejected', reason: 'safety_blocked' };
                return state;
            }
            const expectedConcernIds = review.concerns.map(item => item.id).sort();
            const acceptedConcernIds = [...new Set(input.acceptedConcernIds)].sort();
            if (expectedConcernIds.length !== acceptedConcernIds.length
                || expectedConcernIds.some((id, index) => id !== acceptedConcernIds[index])) {
                result = { status: 'rejected', reason: 'accepted_concerns_mismatch' };
                return state;
            }
            if (review.conclusion === 'not_ready' && !meaningful(input.rationale)) {
                result = { status: 'rejected', reason: 'rationale_required' };
                return state;
            }
            if (review.concerns.some(item => item.blocking) && !meaningful(input.containmentPlan)) {
                result = { status: 'rejected', reason: 'containment_required' };
                return state;
            }
            const events = state.readinessCommitmentEvents[projectId] ?? [];
            const event = sealReadinessCommitmentEvent({
                eventSchemaVersion: 1,
                id: uuidv4(), projectId, reviewId, actor: 'user', type: 'commit_authorized',
                at: Math.max(Date.now(), (events.at(-1)?.at ?? 0) + 1),
                spineVersionId: review.spineVersionId,
                snapshotHash: readinessReviewSnapshotHash(review), integrityHash: review.integrityHash,
                aggregateHash: review.snapshotHashes.aggregate,
                acceptedConcernIds,
                rationale: input.rationale?.trim() ?? '',
                ...(input.containmentPlan?.trim() && { containmentPlan: input.containmentPlan.trim() }),
            }) as Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }>;
            result = { status: 'authorized', authorizationEventId: event.id };
            return {
                readinessCommitmentEvents: {
                    ...state.readinessCommitmentEvents,
                    [projectId]: [...events, event],
                },
            };
        });
        return result;
    },

    commitReadinessReview: (projectId, reviewId, authorizationEventId) => {
        let result: ReturnType<ProjectState['commitReadinessReview']> = { status: 'rejected', reason: 'review_not_found' };
        set((state) => {
            const review = (state.readinessReviews[projectId] ?? []).find(item => item.id === reviewId);
            if (!review) return state;
            if (!validateReadinessReviewIntegrity(review)) {
                result = { status: 'rejected', reason: 'tampered' };
                return state;
            }
            const events = state.readinessCommitmentEvents[projectId] ?? [];
            const authorization = events.find((event): event is Extract<ReadinessCommitmentEvent, { type: 'commit_authorized' }> => (
                event.id === authorizationEventId && event.type === 'commit_authorized'
            ));
            if (!authorization) {
                result = { status: 'rejected', reason: 'authorization_not_found' };
                return state;
            }
            if (!readinessAuthorizationMatchesReview(authorization, review)) {
                result = { status: 'rejected', reason: 'hash_mismatch' };
                return state;
            }
            if (events.some(event => event.type === 'plan_committed'
                && event.authorizationEventId === authorizationEventId)) {
                result = { status: 'rejected', reason: 'authorization_consumed' };
                return state;
            }
            const spine = (state.spineVersions[projectId] ?? []).find(item => (
                item.id === review.spineVersionId && item.isLatest
            ));
            if (spine?.safetyReview?.status === 'blocked') {
                result = { status: 'rejected', reason: 'safety_blocked' };
                return state;
            }
            const currentInput = buildReadinessReviewInputFromState(state, projectId, Date.now());
            if (!currentInput || !compareReadinessReviewCurrentness(review, currentInput).current) {
                result = { status: 'rejected', reason: 'stale' };
                return state;
            }
            const activeCommit = deriveReadinessCommitmentState(review, events).activeCommit;
            if (activeCommit) {
                result = { status: 'rejected', reason: 'already_committed' };
                return state;
            }
            const event = sealReadinessCommitmentEvent({
                eventSchemaVersion: 1,
                id: uuidv4(), projectId, reviewId, actor: 'user', type: 'plan_committed',
                at: Math.max(Date.now(), (events.at(-1)?.at ?? 0) + 1),
                spineVersionId: review.spineVersionId,
                snapshotHash: readinessReviewSnapshotHash(review), integrityHash: review.integrityHash,
                aggregateHash: review.snapshotHashes.aggregate,
                authorizationEventId,
            }) as Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }>;
            result = { status: 'committed', commitmentEventId: event.id };
            return {
                readinessCommitmentEvents: {
                    ...state.readinessCommitmentEvents,
                    [projectId]: [...events, event],
                },
                spineVersions: {
                    ...state.spineVersions,
                    [projectId]: (state.spineVersions[projectId] ?? []).map(spine => (
                        spine.id === review.spineVersionId ? { ...spine, isFinal: true } : spine
                    )),
                },
                historyEvents: {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] ?? []), {
                        id: uuidv4(), projectId, spineVersionId: review.spineVersionId,
                        readinessReviewId: review.id,
                        type: 'PlanCommitted',
                        description: review.conclusion === 'ready_to_build'
                            ? 'Committed this reviewed plan as the implementation foundation'
                            : 'Committed this reviewed plan with open questions',
                        createdAt: event.at,
                    }],
                },
            };
        });
        return result;
    },

    reopenReadinessCommitment: (projectId, commitmentEventId, reason) => {
        let result: ReturnType<ProjectState['reopenReadinessCommitment']> = { status: 'rejected', reason: 'commitment_not_found' };
        set((state) => {
            const events = state.readinessCommitmentEvents[projectId] ?? [];
            const commitment = events.find((event): event is Extract<ReadinessCommitmentEvent, { type: 'plan_committed' }> => (
                event.id === commitmentEventId && event.type === 'plan_committed'
            ));
            if (!commitment) return state;
            if (events.some(event => event.type === 'plan_reopened' && event.priorCommitEventId === commitmentEventId)) {
                result = { status: 'rejected', reason: 'not_committed' };
                return state;
            }
            const review = (state.readinessReviews[projectId] ?? []).find(item => item.id === commitment.reviewId);
            if (!review || !validateReadinessReviewIntegrity(review) || !bindingMatches(commitment, review)) {
                result = { status: 'rejected', reason: 'tampered' };
                return state;
            }
            const authoritative = deriveReadinessCommitmentState(review, events).activeCommit;
            if (authoritative?.id !== commitmentEventId) {
                result = { status: 'rejected', reason: 'tampered' };
                return state;
            }
            const event = sealReadinessCommitmentEvent({
                eventSchemaVersion: 1,
                id: uuidv4(), projectId, reviewId: commitment.reviewId, actor: 'user', type: 'plan_reopened',
                at: Math.max(Date.now(), (events.at(-1)?.at ?? 0) + 1),
                spineVersionId: commitment.spineVersionId,
                snapshotHash: commitment.snapshotHash, integrityHash: commitment.integrityHash,
                aggregateHash: commitment.aggregateHash,
                priorCommitEventId: commitment.id,
                ...(reason?.trim() && { reason: reason.trim() }),
            }) as Extract<ReadinessCommitmentEvent, { type: 'plan_reopened' }>;
            result = { status: 'reopened', reopenEventId: event.id };
            return {
                readinessCommitmentEvents: {
                    ...state.readinessCommitmentEvents,
                    [projectId]: [...events, event],
                },
                spineVersions: {
                    ...state.spineVersions,
                    [projectId]: (state.spineVersions[projectId] ?? []).map(spine => (
                        spine.id === commitment.spineVersionId ? { ...spine, isFinal: false } : spine
                    )),
                },
                historyEvents: {
                    ...state.historyEvents,
                    [projectId]: [...(state.historyEvents[projectId] ?? []), {
                        id: uuidv4(), projectId, spineVersionId: commitment.spineVersionId,
                        readinessReviewId: commitment.reviewId,
                        type: 'PlanReopened', description: 'Returned this committed plan to working status',
                        createdAt: event.at,
                    }],
                },
            };
        });
        return result;
    },
});
