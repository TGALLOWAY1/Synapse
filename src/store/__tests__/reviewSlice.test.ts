import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProjectStore } from '../projectStore';
import { markInterruptedReviews } from '../interruptedReviews';
import type { PersistedReviewContextManifest, ReviewRun, SpecialistRun } from '../../types';

const manifest: PersistedReviewContextManifest = {
    spineVersionId: 'spine-v2',
    spineContentHash: 'spine-hash',
    artifactRefs: [
        { artifactId: 'artifact-1', artifactVersionId: 'artifact-v3', subtype: 'data_model', contentHash: 'artifact-hash' },
    ],
    capturedAt: 100,
    contextSignature: 'context-hash',
};

beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(1_000);
    useProjectStore.setState({
        reviewRuns: {},
        specialistRuns: {},
        reviewFindings: {},
        reviewIssues: {},
        planningRecords: {},
    });
});

describe('adversarial review domain', () => {
    it('creates a durable version-pinned review and independent specialist run', () => {
        const store = useProjectStore.getState();
        const { reviewId } = store.createReviewRun('p1', {
            scope: { kind: 'project' },
            sourceManifest: manifest,
            selectedSpecialists: [{ specialistId: 'security_privacy', label: 'Security & Privacy', reason: 'Auth is in scope' }],
        });
        const { specialistRunId } = useProjectStore.getState().createSpecialistRun('p1', {
            reviewId,
            specialistId: 'security_privacy',
            responsibility: 'Review trust boundaries',
            boundaries: ['Do not invent legal requirements'],
            contextRefIds: ['spine-v2', 'artifact-v3'],
        });

        const state = useProjectStore.getState();
        expect(state.reviewRuns.p1[0]).toMatchObject({
            id: reviewId,
            sequenceNumber: 1,
            status: 'queued',
            synthesisStatus: 'pending',
            sourceManifest: manifest,
        });
        expect(state.specialistRuns.p1[0]).toMatchObject({
            id: specialistRunId,
            reviewId,
            status: 'queued',
            findingIds: [],
        });
    });

    it('never auto-confirms a record proposed by specialist review', () => {
        const { planningRecordId } = useProjectStore.getState().createPlanningRecord('p1', {
            type: 'decision',
            status: 'confirmed', // unsafe caller input is intentionally ignored
            title: 'Choose retention policy',
            statement: 'How long should audit events be retained?',
            evidence: [],
            sourceFindingIds: ['finding-1'],
            createdBy: 'specialist_review',
            confirmedAt: 500,
        });
        const record = useProjectStore.getState().planningRecords.p1.find(r => r.id === planningRecordId)!;
        expect(record.status).toBe('proposed');
        expect(record.confirmedAt).toBeUndefined();

        useProjectStore.getState().updatePlanningRecordStatusByUser('p1', planningRecordId, 'confirmed', {
            resolution: 'Retain for 90 days',
        });
        expect(useProjectStore.getState().planningRecords.p1[0]).toMatchObject({
            status: 'confirmed',
            confirmedAt: 1_000,
            resolution: 'Retain for 90 days',
        });
    });

    it('records issue dispositions with user provenance and a context signature', () => {
        const { issueId } = useProjectStore.getState().addReviewIssue('p1', {
            reviewId: 'review-1',
            title: 'Authorization is undefined',
            summary: 'The data model has roles but the API behavior has no authorization rule.',
            kind: 'missing_information',
            findingIds: ['finding-1'],
            specialistIds: ['security_privacy'],
            relationship: 'standalone',
            severity: 'high',
            confidence: 'high',
            implementationImpact: 'resolve_before_build',
            relatedPlanningRecordIds: [],
        });
        useProjectStore.getState().applyReviewIssueDisposition('p1', issueId, {
            action: 'dismiss',
            reason: 'Handled in an external security specification',
            contextSignature: manifest.contextSignature,
        });

        expect(useProjectStore.getState().reviewIssues.p1[0]).toMatchObject({
            status: 'dismissed',
            dispositions: [{
                action: 'dismiss',
                actor: 'user',
                at: 1_000,
                contextSignature: 'context-hash',
            }],
        });
    });
});

describe('review interruption recovery', () => {
    it('interrupts active work while preserving completed specialists', () => {
        const active = {
            id: 'r1', projectId: 'p1', sequenceNumber: 1, scope: { kind: 'project' as const },
            sourceManifest: manifest, selectedSpecialists: [], status: 'synthesizing' as const,
            synthesisStatus: 'running' as const, createdAt: 1,
        } satisfies ReviewRun;
        const running = {
            id: 's1', projectId: 'p1', reviewId: 'r1', specialistId: 'security_privacy',
            responsibility: 'Security', boundaries: [], contextRefIds: [], status: 'running' as const,
            attemptCount: 1, findingIds: [], createdAt: 1,
        } satisfies SpecialistRun;
        const complete = { ...running, id: 's2', specialistId: 'product_scope', status: 'complete' as const };
        const runs = { p1: [active] };
        const specialists = { p1: [running, complete] };

        markInterruptedReviews(runs, specialists);

        expect(runs.p1[0]).toMatchObject({ status: 'interrupted', synthesisStatus: 'interrupted' });
        expect(specialists.p1.map(run => run.status)).toEqual(['interrupted', 'complete']);
    });
});

