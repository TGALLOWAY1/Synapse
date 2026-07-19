import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, PersistedReviewContextManifest, PlanningRecord, SpineVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import {
    DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT,
    REVIEW_RUN_RETENTION_LIMIT,
} from '../../lib/collectionRetention';
import { useProjectStore } from '../projectStore';

const projectId = 'retention-project';

const spine: SpineVersion = {
    id: 'spine-1', projectId, promptText: 'Plan', responseText: 'The plan', createdAt: 2, isLatest: true, isFinal: false,
};

const manifest: PersistedReviewContextManifest = {
    spineVersionId: spine.id,
    spineContentHash: 'spine-hash',
    artifactRefs: [],
    capturedAt: 100,
    contextSignature: 'context-hash',
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] },
        reviewRuns: {},
        specialistRuns: {},
        reviewFindings: {},
        reviewIssues: {},
        planningRecords: {},
        artifacts: {},
        artifactVersions: {},
        downstreamUpdatePlans: {},
        downstreamUpdatePlanEvents: {},
        downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {},
        downstreamArtifactUpdateVerificationEvents: {},
    });
});

const createCompletedReviewRun = (): string => {
    const { reviewId } = useProjectStore.getState().createReviewRun(projectId, {
        scope: { kind: 'project' },
        sourceManifest: manifest,
        selectedSpecialists: [],
    });
    useProjectStore.getState().updateReviewRun(projectId, reviewId, { status: 'complete', synthesisStatus: 'complete' });
    return reviewId;
};

describe('review-slice retention integration', () => {
    it('caps settled review runs at the retention limit and cascades their specialist runs and findings', () => {
        const firstReviewId = createCompletedReviewRun();
        const { specialistRunId } = useProjectStore.getState().createSpecialistRun(projectId, {
            reviewId: firstReviewId,
            specialistId: 'product_scope',
            responsibility: 'Challenge the scope',
            boundaries: [],
            contextRefIds: [],
        });
        useProjectStore.getState().addReviewFinding(projectId, {
            id: 'finding-1', reviewId: firstReviewId, specialistRunId, specialistId: 'product_scope',
            kind: 'risk', title: 'Old risk', observation: 'Observed', whyItMatters: 'It matters',
            severity: 'medium', confidence: 'medium', implementationImpact: 'deferrable',
            evidence: [], fingerprint: 'fp-1', grounded: true, createdAt: 1,
        });

        const extraRuns = REVIEW_RUN_RETENTION_LIMIT + 4;
        for (let index = 0; index < extraRuns; index += 1) createCompletedReviewRun();

        const state = useProjectStore.getState();
        const runs = state.reviewRuns[projectId];
        // The most recent completed project-scope challenge of the latest
        // spine is additionally protected, so the window is limit + 1 here.
        expect(runs.length).toBeLessThanOrEqual(REVIEW_RUN_RETENTION_LIMIT + 1);
        expect(runs.some(run => run.id === firstReviewId)).toBe(false);
        expect(state.specialistRuns[projectId]).toEqual([]);
        expect(state.reviewFindings[projectId]).toEqual([]);
        // Sequence numbers stay monotonic across pruning: max-based, not
        // length-based, so the next run never collides with a retained one.
        expect(runs.at(-1)?.sequenceNumber).toBe(1 + extraRuns);
        const nextId = createCompletedReviewRun();
        expect(useProjectStore.getState().reviewRuns[projectId].find(run => run.id === nextId)?.sequenceNumber)
            .toBe(2 + extraRuns);
    });

    it('retains a pruned-window run for as long as it has an open issue', () => {
        const protectedReviewId = createCompletedReviewRun();
        useProjectStore.getState().addReviewIssue(projectId, {
            reviewId: protectedReviewId,
            title: 'Unresolved issue', summary: 'Still open.', kind: 'risk',
            findingIds: [], specialistIds: ['product_scope'], relationship: 'standalone',
            severity: 'high', confidence: 'high', implementationImpact: 'resolve_before_build',
            relatedPlanningRecordIds: [],
        });
        for (let index = 0; index < REVIEW_RUN_RETENTION_LIMIT + 4; index += 1) createCompletedReviewRun();

        const state = useProjectStore.getState();
        expect(state.reviewRuns[projectId].some(run => run.id === protectedReviewId)).toBe(true);
        expect(state.reviewIssues[projectId]).toHaveLength(1);
    });
});

describe('downstream-update-plan retention integration', () => {
    const artifact: Artifact = {
        id: 'screens', projectId, type: 'core_artifact', subtype: 'screen_inventory', title: 'Screens',
        status: 'active', currentVersionId: 'screens-v1', createdAt: 1, updatedAt: 1,
    };
    const version: ArtifactVersion = {
        id: 'screens-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null,
        content: 'screen content', metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
    };
    const record: PlanningRecord = {
        id: 'decision-1', projectId, type: 'decision', status: 'confirmed', title: 'Storage', statement: 'Storage choice',
        resolution: 'Local only', evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
    };
    const makePlan = (id: string) => sealDownstreamUpdatePlan({
        schemaVersion: 1, id, projectId, authoredBy: 'synapse', createdAt: 10,
        source: {
            kind: 'planning_change', summary: `Change ${id}.`, targetSpineVersionId: spine.id,
            targetSpineContentHash: hashReviewValue(spine.responseText),
            planningContextHash: downstreamPlanningContextHash([record]),
            planningRecordId: record.id, confirmed: true,
        },
        artifact: {
            artifactId: artifact.id, artifactVersionId: version.id,
            artifactContentHash: hashReviewValue(version.content), slot: 'screen_inventory', title: artifact.title,
        },
        items: [],
        preservedArtifactSummary: 'Everything preserved.',
    });

    it('caps recorded plans per artifact at the retention limit, keeping the newest', () => {
        useProjectStore.setState({
            artifacts: { [projectId]: [artifact] },
            artifactVersions: { [projectId]: [version] },
            planningRecords: { [projectId]: [record] },
        });
        const total = DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT + 2;
        for (let index = 0; index < total; index += 1) {
            expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, makePlan(`plan-${index}`)))
                .toEqual({ ok: true, duplicate: false });
        }
        const plans = useProjectStore.getState().downstreamUpdatePlans[projectId];
        expect(plans).toHaveLength(DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT);
        expect(plans[0].id).toBe('plan-2');
        expect(plans.at(-1)?.id).toBe(`plan-${total - 1}`);
    });
});
