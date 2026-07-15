import { describe, expect, it } from 'vitest';
import type { ReadinessCommitmentEvent, ReadinessReview } from '../../types';
import {
    buildReadinessCheckpointView,
    readinessCommitmentState,
} from '../planning/readinessCheckpointView';

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
    snapshotHash: 'snapshot', integrityHash: 'integrity', aggregateHash: 'aggregate',
};

describe('readiness checkpoint authority projection', () => {
    it('shows an override only from the exact user authorization referenced by the commit', () => {
        const events: ReadinessCommitmentEvent[] = [
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
        ];

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
        const events: ReadinessCommitmentEvent[] = [
            {
                ...eventBase, id: 'auth-1', type: 'commit_authorized', at: 1,
                acceptedConcernIds: ['concern-1'], rationale: 'Proceed with a contained prototype.',
            },
            { ...eventBase, id: 'commit-1', type: 'plan_committed', at: 2, authorizationEventId: 'auth-1' },
            { ...eventBase, id: 'reopen-1', type: 'plan_reopened', at: 3, priorCommitEventId: 'commit-1' },
        ];
        const state = readinessCommitmentState(review, events);
        expect(state.latestCommit?.id).toBe('commit-1');
        expect(state.activeCommit).toBeUndefined();
        expect(state.reopenedAt).toBe(3);
    });

    it('never manufactures commitment authority from a review alone', () => {
        const state = readinessCommitmentState(review, []);
        expect(state.activeCommit).toBeUndefined();
        expect(buildReadinessCheckpointView(review, { current: true, historical: false, integrityValid: true, reasons: [] }, [], 'Version 2').commitment).toBeUndefined();
    });
});
