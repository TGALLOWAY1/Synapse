import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
    PersistedReviewContextManifest,
    ReadinessReview,
    ReviewRun,
    SpecialistRun,
    SpineVersion,
} from '../../types';
import type { DownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import {
    DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT,
    READINESS_REVIEW_RETENTION_LIMIT,
    REVIEW_RUN_RETENTION_LIMIT,
} from '../../lib/collectionRetention';
import { useProjectStore } from '../projectStore';
import { applyProjectUser } from '../projectUserSync';
import { namespaceFor, setActiveProjectUser } from '../userScope';
import { decodePersistedBlob } from '../persistCodec';

// Stored values may be compressed above the codec threshold — always decode
// before parsing a raw blob in assertions.
const readStoredState = (key: string) => {
    const json = decodePersistedBlob(localStorage.getItem(key));
    return JSON.parse(json!);
};

// Flush the 500ms debounced persist writer deterministically. Microtasks stay
// real (vitest doesn't fake queueMicrotask by default), so a bare
// `await Promise.resolve()` flushes the sweep's deferred persist setState.
vi.useFakeTimers();
const flushPersist = () => {
    vi.runOnlyPendingTimers();
};
const flushSweepPersist = async () => {
    await Promise.resolve();
    flushPersist();
};

const projectId = 'legacy-project';
const BASE_KEY = 'synapse-projects-storage';

const spine: SpineVersion = {
    id: 'spine-1',
    projectId,
    promptText: 'Prompt',
    responseText: 'Response',
    createdAt: 1,
    isLatest: true,
    isFinal: false,
};

const manifest: PersistedReviewContextManifest = {
    spineVersionId: spine.id,
    spineContentHash: 'spine-hash',
    artifactRefs: [],
    capturedAt: 1,
    contextSignature: 'sig',
};

const reviewRun = (index: number): ReviewRun => ({
    id: `run-${index}`,
    projectId,
    sequenceNumber: index + 1,
    scope: { kind: 'project' },
    sourceManifest: manifest,
    selectedSpecialists: [],
    status: 'complete',
    synthesisStatus: 'complete',
    createdAt: index,
});

const specialistRun = (reviewId: string): SpecialistRun => ({
    id: `${reviewId}-s`,
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

const readinessReview = (index: number): ReadinessReview => ({
    id: `rr-${index}`,
    projectId,
    schemaVersion: 1,
    criteriaVersion: 2,
    conclusion: 'not_ready',
    spineVersionId: spine.id,
    snapshotHashes: {
        spineIdentity: 'a', spineContent: 'b', planningState: 'c',
        challenge: 'd', alignment: 'e', downstream: 'f', aggregate: `agg-${index}`,
    },
    criteria: [],
    concerns: [],
    caveats: [],
    createdAt: index,
    integrityHash: `hash-${index}`,
});

const downstreamPlan = (index: number): DownstreamUpdatePlan => ({
    schemaVersion: 1,
    id: `plan-${index}`,
    projectId,
    authoredBy: 'synapse',
    source: {
        kind: 'planning_change',
        summary: 'A confirmed decision changed the plan.',
        targetSpineVersionId: spine.id,
        targetSpineContentHash: 'spine-hash',
        planningContextHash: 'planning-hash',
        confirmed: true,
    },
    artifact: {
        artifactId: 'a1',
        artifactVersionId: 'a1-v1',
        artifactContentHash: 'content-hash',
        slot: 'screen_inventory',
        title: 'Screens',
    },
    items: [],
    preservedArtifactSummary: 'Everything else is preserved.',
    createdAt: index,
    integrityHash: `plan-hash-${index}`,
});

/** A persisted blob whose review/readiness/downstream history is over every cap
 *  — the state of a user stuck behind the "Storage full" quota toast. */
const oversizedPersistedState = () => {
    const runs = Array.from({ length: REVIEW_RUN_RETENTION_LIMIT + 5 }, (_, index) => reviewRun(index));
    return {
        projects: { [projectId]: { id: projectId, name: 'Legacy', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] },
        reviewRuns: { [projectId]: runs },
        specialistRuns: { [projectId]: runs.map(run => specialistRun(run.id)) },
        reviewFindings: {},
        reviewIssues: {},
        readinessReviews: {
            [projectId]: Array.from(
                { length: READINESS_REVIEW_RETENTION_LIMIT + 3 },
                (_, index) => readinessReview(index),
            ),
        },
        readinessCommitmentEvents: {},
        downstreamUpdatePlans: {
            [projectId]: Array.from(
                { length: DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT + 2 },
                (_, index) => downstreamPlan(index),
            ),
        },
    };
};

const blob = (state: object) => JSON.stringify({ state, version: 0 });

beforeEach(() => {
    localStorage.clear();
    setActiveProjectUser(null);
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        reviewRuns: {},
        specialistRuns: {},
        reviewFindings: {},
        reviewIssues: {},
        readinessReviews: {},
        readinessCommitmentEvents: {},
        downstreamUpdatePlans: {},
        downstreamUpdatePlanEvents: {},
        downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {},
        downstreamArtifactUpdateVerificationEvents: {},
    });
    // The reset above queues a debounced persist write; flush it now so no
    // stale pending write can fire mid-test and clobber a seeded blob.
    flushPersist();
});

describe('rehydrate-time retention sweep', () => {
    it('shrinks an oversized legacy state on rehydrate and persists the shrunken state', async () => {
        localStorage.setItem(BASE_KEY, blob(oversizedPersistedState()));

        void useProjectStore.persist.rehydrate();

        const state = useProjectStore.getState();
        // All runs are completed project-scope challenges of the latest spine,
        // so the protected substantive candidate is inside the recency window.
        expect(state.reviewRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
        expect(state.specialistRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
        expect(state.readinessReviews[projectId]).toHaveLength(READINESS_REVIEW_RETENTION_LIMIT);
        expect(state.downstreamUpdatePlans[projectId]).toHaveLength(DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT);
        // Version history and the project itself are untouched.
        expect(state.spineVersions[projectId]).toHaveLength(1);
        expect(state.projects[projectId]).toBeDefined();

        // The sweep's deferred setState persists the shrunken state through the
        // normal debounced writer.
        await flushSweepPersist();
        const stored = readStoredState(BASE_KEY);
        expect(stored.state.reviewRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
        expect(stored.state.readinessReviews[projectId]).toHaveLength(READINESS_REVIEW_RETENTION_LIMIT);
        expect(stored.state.downstreamUpdatePlans[projectId]).toHaveLength(DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT);
    });

    it('leaves an under-cap state untouched: no state change and no extra persist', async () => {
        const underCap = {
            ...oversizedPersistedState(),
            reviewRuns: { [projectId]: [reviewRun(0)] },
            specialistRuns: { [projectId]: [specialistRun('run-0')] },
            readinessReviews: { [projectId]: [readinessReview(0)] },
            downstreamUpdatePlans: { [projectId]: [downstreamPlan(0)] },
        };
        const raw = blob(underCap);
        localStorage.setItem(BASE_KEY, raw);

        void useProjectStore.persist.rehydrate();
        const stateAfterRehydrate = useProjectStore.getState();
        expect(stateAfterRehydrate.reviewRuns[projectId]).toHaveLength(1);

        // No deferred sweep setState fires: the store state reference is
        // stable across the microtask boundary and nothing is re-persisted.
        await Promise.resolve();
        expect(useProjectStore.getState()).toBe(stateAfterRehydrate);
        flushPersist();
        expect(localStorage.getItem(BASE_KEY)).toBe(raw);
    });

    it('sweeps an oversized namespace when switching users (applyProjectUser rehydrate)', () => {
        localStorage.setItem(namespaceFor('user-a'), blob(oversizedPersistedState()));

        applyProjectUser('user-a');

        const state = useProjectStore.getState();
        expect(state.reviewRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
        expect(state.readinessReviews[projectId]).toHaveLength(READINESS_REVIEW_RETENTION_LIMIT);
        expect(state.downstreamUpdatePlans[projectId]).toHaveLength(DOWNSTREAM_PLAN_RETENTION_LIMIT_PER_ARTIFACT);

        // The switch's own re-persist writes the swept state back to the
        // namespace (the sweep ran inside the rehydrate it triggered).
        flushPersist();
        const stored = readStoredState(namespaceFor('user-a'));
        expect(stored.state.reviewRuns[projectId]).toHaveLength(REVIEW_RUN_RETENTION_LIMIT);
        expect(stored.state.projects[projectId]).toBeDefined();
    });
});
