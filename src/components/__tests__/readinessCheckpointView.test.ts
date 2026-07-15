import { describe, expect, it } from 'vitest';
import type { ReadinessCommitmentEvent, ReadinessReview } from '../../types';
import {
    buildReadinessCheckpointView,
    readinessNavigationDestination,
} from '../planning/readinessCheckpointView';
import {
    deriveReadinessCommitmentState,
    hasReadinessProvenanceForSpine,
    readinessReviewSnapshotHash,
    sealReadinessCommitmentEvent,
} from '../../lib/planning/readinessCommitment';

const review: ReadinessReview = {
    id: 'ready-1',
    projectId: 'project-1',
    schemaVersion: 1,
    criteriaVersion: 1,
    conclusion: 'not_ready',
    spineVersionId: 'spine-2',
    snapshotHashes: {
        spineIdentity: 'identity', spineContent: 'content', planningState: 'planning',
        challenge: 'challenge', alignment: 'alignment', downstream: 'downstream', aggregate: 'aggregate',
    },
    criteria: [{
        id: 'decisions', label: 'Consequential decisions resolved', status: 'attention', blocking: true,
        explanation: 'One decision remains open.', evidence: [],
        actionTarget: { kind: 'planning_record', planningRecordId: 'decision-1' },
    }],
    concerns: [{
        id: 'concern-1', criterionId: 'decisions', kind: 'decision', title: 'Choose account behavior',
        consequence: 'Onboarding and persistence depend on this choice.', blocking: true,
        evidenceQuality: 'incomplete', source: { type: 'planning_record', sourceId: 'decision-1' },
        actionTarget: { kind: 'planning_record', planningRecordId: 'decision-1' },
    }],
    caveats: [],
    createdAt: 100,
    integrityHash: 'integrity',
};

const eventBase = {
    projectId: 'project-1', reviewId: review.id, actor: 'user' as const, spineVersionId: 'spine-2',
    snapshotHash: readinessReviewSnapshotHash(review), integrityHash: 'integrity', aggregateHash: 'aggregate',
};

const sealEvents = (events: object[]): ReadinessCommitmentEvent[] => events.map(event => (
    sealReadinessCommitmentEvent({ eventSchemaVersion: 1, ...event } as Parameters<typeof sealReadinessCommitmentEvent>[0])
));

describe('readiness checkpoint authority projection', () => {
    it('shows an override only from the exact user authorization referenced by the commit', () => {
        const events = sealEvents([
            {
                ...eventBase, id: 'auth-unrelated', type: 'commit_authorized', at: 1,
                acceptedConcernIds: [], rationale: 'Unrelated authorization.',
            },
            {
                ...eventBase, id: 'auth-1', type: 'commit_authorized', at: 2,
                acceptedConcernIds: ['concern-1'], rationale: 'Proceed with a contained prototype.',
                containmentPlan: 'Use synthetic inputs and prohibit deployment.',
            },
            {
                ...eventBase, id: 'commit-1', type: 'plan_committed', at: 3,
                authorizationEventId: 'auth-1',
            },
        ]);

        const view = buildReadinessCheckpointView(review, { current: true, historical: false, integrityValid: true, reasons: [] }, events, 'Version 2');
        expect(view.commitment).toMatchObject({
            kind: 'with_open_questions',
            acceptedConcernCount: 1,
            rationale: 'Proceed with a contained prototype.',
            containment: 'Use synthetic inputs and prohibit deployment.',
        });
        expect(view.concerns[0]).toMatchObject({ severity: 'blocker', actionLabel: 'Resolve in Decision Center' });
    });

    it('does not treat a reopened commitment as current authority', () => {
        const events = sealEvents([
            {
                ...eventBase, id: 'auth-1', type: 'commit_authorized', at: 1,
                acceptedConcernIds: ['concern-1'], rationale: 'Proceed with a contained prototype.',
                containmentPlan: 'Use synthetic inputs and prohibit production deployment.',
            },
            { ...eventBase, id: 'commit-1', type: 'plan_committed', at: 2, authorizationEventId: 'auth-1' },
            { ...eventBase, id: 'reopen-1', type: 'plan_reopened', at: 3, priorCommitEventId: 'commit-1' },
        ]);
        const state = deriveReadinessCommitmentState(review, events);
        expect(state.latestCommit?.id).toBe('commit-1');
        expect(state.activeCommit).toBeUndefined();
        expect(state.reopenedAt).toBe(3);
        const view = buildReadinessCheckpointView(review, {
            current: true, historical: false, integrityValid: true, reasons: [],
        }, events, 'Version 2');
        expect(view.commitment).toBeUndefined();
        expect(view.priorCommitment).toMatchObject({
            kind: 'with_open_questions',
            reopenedAt: 3,
            rationale: 'Proceed with a contained prototype.',
        });
    });

    it('keeps a ready commitment ready when advisory concerns are accepted', () => {
        const readyReview: ReadinessReview = {
            ...review,
            conclusion: 'ready_to_build',
            criteria: review.criteria.map(item => ({ ...item, blocking: false })),
            concerns: review.concerns.map(item => ({ ...item, blocking: false })),
        };
        const events = sealEvents([
            {
                ...eventBase, id: 'auth-ready', type: 'commit_authorized', at: 1,
                acceptedConcernIds: ['concern-1'], rationale: '',
            },
            { ...eventBase, id: 'commit-ready', type: 'plan_committed', at: 2, authorizationEventId: 'auth-ready' },
        ]);
        const view = buildReadinessCheckpointView(readyReview, {
            current: true, historical: false, integrityValid: true, reasons: [],
        }, events, 'Version 2');
        expect(view.commitment).toMatchObject({ kind: 'ready', acceptedConcernCount: 1 });
    });

    it('does not project commitment authority from an integrity-invalid review', () => {
        const events = sealEvents([
            {
                ...eventBase, id: 'auth-1', type: 'commit_authorized', at: 1,
                acceptedConcernIds: ['concern-1'], rationale: 'Proceed with a contained prototype.',
            },
            { ...eventBase, id: 'commit-1', type: 'plan_committed', at: 2, authorizationEventId: 'auth-1' },
        ]);
        const view = buildReadinessCheckpointView(review, {
            current: false, historical: false, integrityValid: false, reasons: ['integrity_mismatch'],
        }, events, 'Version 2');
        expect(view.integrityValid).toBe(false);
        expect(view.commitment).toBeUndefined();
        expect(view.priorCommitment).toBeUndefined();
        expect(view.currentnessReasons).toContain('The stored checkpoint no longer matches its integrity signature.');
    });

    it('rejects restored commitment events with forged authority, mismatched hashes, or invalid authorization linkage', () => {
        const validAuthorization = {
            ...eventBase, id: 'auth-valid', type: 'commit_authorized', at: 1,
            acceptedConcernIds: ['concern-1'],
            rationale: 'Proceed with a deliberately contained prototype.',
            containmentPlan: 'Use synthetic inputs and prohibit production deployment.',
        };
        const invalidSets = [
            sealEvents([
                { ...validAuthorization, actor: 'assistant' },
                { ...eventBase, id: 'commit-forged', type: 'plan_committed', at: 2, authorizationEventId: 'auth-valid' },
            ]),
            sealEvents([
                validAuthorization,
                { ...eventBase, id: 'commit-mismatch', type: 'plan_committed', at: 2, authorizationEventId: 'auth-valid', aggregateHash: 'wrong' },
            ]),
            sealEvents([
                { ...eventBase, id: 'commit-orphan', type: 'plan_committed', at: 2, authorizationEventId: 'missing-auth' },
            ]),
        ];

        for (const events of invalidSets) {
            expect(deriveReadinessCommitmentState(review, events).activeCommit).toBeUndefined();
            const view = buildReadinessCheckpointView(review, {
                current: true, historical: false, integrityValid: true, reasons: [],
            }, events, 'Version 2');
            expect(view.commitment).toBeUndefined();
        }
    });

    it('rejects legacy, forged, or payload-tampered commitment event chains', () => {
        const valid = sealEvents([
            {
                ...eventBase, id: 'auth-integrity', type: 'commit_authorized', at: 1,
                acceptedConcernIds: ['concern-1'], rationale: 'Proceed with a deliberately contained prototype.',
                containmentPlan: 'Use synthetic inputs and prohibit production deployment.',
            },
            { ...eventBase, id: 'commit-integrity', type: 'plan_committed', at: 2, authorizationEventId: 'auth-integrity' },
        ]);
        expect(deriveReadinessCommitmentState(review, valid).activeCommit?.id).toBe('commit-integrity');

        const tampered = valid.map(event => event.type === 'commit_authorized'
            ? { ...event, rationale: 'This rationale was modified after authorization.' }
            : event) as ReadinessCommitmentEvent[];
        expect(deriveReadinessCommitmentState(review, tampered).activeCommit).toBeUndefined();

        const legacy = valid.map(event => {
            const copy = { ...event } as Partial<ReadinessCommitmentEvent>;
            delete copy.eventIntegrityHash;
            return copy;
        }) as ReadinessCommitmentEvent[];
        expect(deriveReadinessCommitmentState(review, legacy).activeCommit).toBeUndefined();
    });

    it('never manufactures commitment authority from a review alone', () => {
        const state = deriveReadinessCommitmentState(review, []);
        expect(state.activeCommit).toBeUndefined();
        expect(buildReadinessCheckpointView(review, { current: true, historical: false, integrityValid: true, reasons: [] }, [], 'Version 2').commitment).toBeUndefined();
    });

    it('does not let invalid Phase 3 authority fall back to legacy finality', () => {
        const forged = [{
            ...eventBase, eventSchemaVersion: 1, eventIntegrityHash: 'invalid',
            id: 'forged-commit', type: 'plan_committed', at: 2, authorizationEventId: 'forged-auth',
        }] as ReadinessCommitmentEvent[];
        expect(deriveReadinessCommitmentState(review, forged).activeCommit).toBeUndefined();
        expect(hasReadinessProvenanceForSpine([review], forged, review.spineVersionId)).toBe(true);
        expect(hasReadinessProvenanceForSpine([], [], review.spineVersionId)).toBe(false);
    });

    it('preserves exact challenge, output, planning-record, and feature targets', () => {
        expect(readinessNavigationDestination({ kind: 'challenge', reviewId: 'review-exact', issueId: 'issue-exact' })).toEqual({
            stage: 'review', tab: 'review', reviewId: 'review-exact', issueId: 'issue-exact', findingId: undefined,
        });
        expect(readinessNavigationDestination({ kind: 'challenge', reviewId: 'review-exact', findingId: 'finding-exact' })).toEqual({
            stage: 'review', tab: 'review', reviewId: 'review-exact', issueId: undefined, findingId: 'finding-exact',
        });
        expect(readinessNavigationDestination({ kind: 'planning_record', planningRecordId: 'decision-exact' })).toEqual({
            stage: 'review', tab: 'decisions', planningRecordId: 'decision-exact',
        });
        expect(readinessNavigationDestination({ kind: 'output', artifactId: 'artifact-exact', nodeId: 'data_model' })).toEqual({
            stage: 'workspace', artifactId: 'artifact-exact', nodeId: 'data_model',
        });
        expect(readinessNavigationDestination({ kind: 'feature', featureId: 'feature-exact' })).toEqual({
            stage: 'prd', anchorId: 'prd-feature-feature-exact',
        });
    });
});
