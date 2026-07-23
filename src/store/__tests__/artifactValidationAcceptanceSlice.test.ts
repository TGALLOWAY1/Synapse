import { beforeEach, describe, expect, it } from 'vitest';
import {
    artifactValidationBlockerSetFingerprint,
    readArtifactValidationDisposition,
} from '../../lib/artifactValidationPolicy';
import type {
    AcceptArtifactValidationIssueInput,
    ArtifactValidationBlocker,
    SourceRef,
} from '../../types';
import { useProjectStore } from '../projectStore';

const semantic: ArtifactValidationBlocker = {
    code: 'prd_traceability_unverified',
    message: 'Traceability was not verified.',
};
const structural: ArtifactValidationBlocker = {
    code: 'output_structure_incomplete',
    message: 'No screens were produced.',
};

beforeEach(() => {
    useProjectStore.setState({
        projects: {},
        spineVersions: {},
        historyEvents: {},
        branches: {},
        artifacts: {},
        artifactVersions: {},
        feedbackItems: {},
        jobs: {},
    });
    localStorage.clear();
});

function seed(blockers: ArtifactValidationBlocker[] = [semantic]) {
    const store = useProjectStore.getState();
    const { projectId, spineId } = store.createProject('P', 'idea');
    const { artifactId } = store.createArtifact(
        projectId,
        'core_artifact',
        'Data Model',
        'data_model',
    );
    const sourceRefs: SourceRef[] = [{
        id: 'spine-ref',
        sourceArtifactId: projectId,
        sourceArtifactVersionId: spineId,
        sourceType: 'spine',
    }];
    const { versionId } = store.createArtifactVersion(
        projectId,
        artifactId,
        '# Data Model',
        { validationBlockers: blockers, repairAttempted: true },
        sourceRefs,
        'Generate data model',
    );
    const request: AcceptArtifactValidationIssueInput = {
        artifactId,
        versionId,
        expectedBlockerFingerprint: artifactValidationBlockerSetFingerprint(blockers),
        rationale: 'The canonical appendix supplies this mapping.',
    };
    return { projectId, spineId, artifactId, versionId, request, sourceRefs };
}

describe('acceptArtifactValidationIssue', () => {
    it('atomically records exact-version acceptance, preserves failures, and appends audit history', () => {
        const seeded = seed();
        const store = useProjectStore.getState();

        expect(store.acceptArtifactValidationIssue(seeded.projectId, seeded.request)).toEqual({
            status: 'accepted',
            artifactId: seeded.artifactId,
            versionId: seeded.versionId,
        });

        const preferred = useProjectStore.getState().getPreferredVersion(
            seeded.projectId,
            seeded.artifactId,
        );
        expect(preferred?.metadata).toMatchObject({
            validationBlockers: [semantic],
            repairAttempted: true,
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                rationale: 'The canonical appendix supplies this mapping.',
                blockerFingerprint: seeded.request.expectedBlockerFingerprint,
            },
        });
        expect(readArtifactValidationDisposition(preferred?.metadata).effectiveStatus)
            .toBe('accepted_issue');
        expect(useProjectStore.getState().getHistoryEvents(seeded.projectId))
            .toContainEqual(expect.objectContaining({
                type: 'ValidationIssueAccepted',
                artifactId: seeded.artifactId,
                artifactVersionId: seeded.versionId,
            }));
    });

    it('rejects whitespace rationale and a changed blocker fingerprint without mutation', () => {
        const seeded = seed();
        const before = useProjectStore.getState().artifactVersions[seeded.projectId];

        expect(useProjectStore.getState().acceptArtifactValidationIssue(seeded.projectId, {
            ...seeded.request,
            rationale: ' \n ',
        })).toEqual({ status: 'rejected', reason: 'rationale_required' });
        expect(useProjectStore.getState().acceptArtifactValidationIssue(seeded.projectId, {
            ...seeded.request,
            expectedBlockerFingerprint: 'stale',
        })).toEqual({ status: 'rejected', reason: 'blockers_changed' });
        expect(useProjectStore.getState().artifactVersions[seeded.projectId]).toBe(before);
        expect(useProjectStore.getState().getHistoryEvents(seeded.projectId)
            .filter(event => event.type === 'ValidationIssueAccepted')).toHaveLength(0);
    });

    it('rejects a version that is no longer preferred', () => {
        const seeded = seed();
        useProjectStore.getState().createArtifactVersion(
            seeded.projectId,
            seeded.artifactId,
            'replacement',
            {},
            seeded.sourceRefs,
            'Regenerate data model',
        );

        expect(useProjectStore.getState().acceptArtifactValidationIssue(
            seeded.projectId,
            seeded.request,
        )).toEqual({ status: 'rejected', reason: 'not_preferred' });
        const oldVersion = useProjectStore.getState().artifactVersions[seeded.projectId]
            .find(version => version.id === seeded.versionId);
        expect(oldVersion?.metadata.validationAcceptance).toBeUndefined();
    });

    it.each([
        ['structural', [structural]],
        ['mixed', [semantic, structural]],
    ])('rejects %s blockers as non-overridable', (_label, blockers) => {
        const seeded = seed(blockers);
        expect(useProjectStore.getState().acceptArtifactValidationIssue(
            seeded.projectId,
            seeded.request,
        )).toEqual({ status: 'rejected', reason: 'non_overridable' });
    });

    it('makes duplicate submission idempotent with one history event', () => {
        const seeded = seed();
        const store = useProjectStore.getState();

        expect(store.acceptArtifactValidationIssue(seeded.projectId, seeded.request).status)
            .toBe('accepted');
        expect(store.acceptArtifactValidationIssue(seeded.projectId, seeded.request))
            .toEqual({ status: 'rejected', reason: 'already_accepted' });
        expect(useProjectStore.getState().getHistoryEvents(seeded.projectId)
            .filter(event => event.type === 'ValidationIssueAccepted')).toHaveLength(1);
    });

    it('clears only matching version-pinned transient needs-review state', () => {
        const matching = seed();
        const matchingStore = useProjectStore.getState();
        matchingStore.initJob(matching.projectId, matching.spineId, ['data_model']);
        matchingStore.setSlotStatus(matching.projectId, 'data_model', {
            status: 'needs_review',
            artifactVersionId: matching.versionId,
            error: { message: 'blocked', category: 'validation', timestamp: 1 },
        });
        matchingStore.acceptArtifactValidationIssue(matching.projectId, matching.request);
        expect(useProjectStore.getState().getSlot(matching.projectId, 'data_model')).toMatchObject({
            status: 'done',
            artifactVersionId: matching.versionId,
        });
        expect(useProjectStore.getState().getSlot(matching.projectId, 'data_model')?.error)
            .toBeUndefined();

        const mismatching = seed();
        const mismatchingStore = useProjectStore.getState();
        mismatchingStore.initJob(mismatching.projectId, mismatching.spineId, ['data_model']);
        mismatchingStore.setSlotStatus(mismatching.projectId, 'data_model', {
            status: 'needs_review',
            artifactVersionId: 'newer-version',
        });
        mismatchingStore.acceptArtifactValidationIssue(mismatching.projectId, mismatching.request);
        expect(useProjectStore.getState().getSlot(mismatching.projectId, 'data_model'))
            .toMatchObject({
                status: 'needs_review',
                artifactVersionId: 'newer-version',
            });
    });

    it('does not copy acceptance into regenerated, reverted, or marked-current versions', () => {
        const seeded = seed();
        const store = useProjectStore.getState();
        store.acceptArtifactValidationIssue(seeded.projectId, seeded.request);

        const regenerated = store.createArtifactVersion(
            seeded.projectId,
            seeded.artifactId,
            'regenerated',
            { validationBlockers: [semantic] },
            seeded.sourceRefs,
            'Regenerate data model',
        );
        expect(useProjectStore.getState().artifactVersions[seeded.projectId]
            .find(version => version.id === regenerated.versionId)
            ?.metadata.validationAcceptance).toBeUndefined();

        const reverted = store.revertArtifactToVersion(
            seeded.projectId,
            seeded.artifactId,
            seeded.versionId,
        );
        const revertedVersion = useProjectStore.getState().artifactVersions[seeded.projectId]
            .find(version => version.id === reverted.versionId);
        expect(revertedVersion?.metadata.validationBlockers).toEqual([semantic]);
        expect(revertedVersion?.metadata.validationAcceptance).toBeUndefined();

        const marked = store.markArtifactCurrentForSpine(
            seeded.projectId,
            seeded.artifactId,
            seeded.spineId,
        );
        const markedVersion = useProjectStore.getState().artifactVersions[seeded.projectId]
            .find(version => version.id === marked.versionId);
        expect(markedVersion?.metadata.validationBlockers).toEqual([semantic]);
        expect(markedVersion?.metadata.validationAcceptance).toBeUndefined();
    });

    it('strips exact-version acceptance at the shared version-creation boundary', () => {
        const seeded = seed();
        const acceptedMetadata = {
            validationBlockers: [semantic],
            validationWarnings: ['Keep this generated warning.'],
            repairAttempted: true,
            validationAcceptance: {
                schemaVersion: 1,
                actor: 'user',
                acceptedAt: 10,
                rationale: 'Acceptance belongs only to the source version.',
                blockerFingerprint: artifactValidationBlockerSetFingerprint([semantic]),
            },
        };

        const cloned = useProjectStore.getState().createArtifactVersion(
            seeded.projectId,
            seeded.artifactId,
            'selectively updated clone',
            acceptedMetadata,
            seeded.sourceRefs,
            'Apply a selective downstream update',
        );
        const created = useProjectStore.getState().artifactVersions[seeded.projectId]
            .find(version => version.id === cloned.versionId);

        expect(created?.metadata).toEqual({
            validationBlockers: [semantic],
            validationWarnings: ['Keep this generated warning.'],
            repairAttempted: true,
        });
    });

    it('reserves validation authority fields from generic metadata updates', () => {
        const seeded = seed();
        useProjectStore.getState().updateArtifactVersionMetadata(
            seeded.projectId,
            seeded.artifactId,
            seeded.versionId,
            {
                validationBlockers: [structural],
                validationAcceptance: {
                    schemaVersion: 1,
                    actor: 'user',
                    acceptedAt: 10,
                    rationale: 'Forged through the generic metadata writer.',
                    blockerFingerprint: artifactValidationBlockerSetFingerprint([structural]),
                },
                planProgress: { milestone: 1 },
            },
        );

        const preferred = useProjectStore.getState().getPreferredVersion(
            seeded.projectId,
            seeded.artifactId,
        );
        expect(preferred?.metadata.validationBlockers).toEqual([semantic]);
        expect(preferred?.metadata.validationAcceptance).toBeUndefined();
        expect(preferred?.metadata.planProgress).toEqual({ milestone: 1 });
    });
});
