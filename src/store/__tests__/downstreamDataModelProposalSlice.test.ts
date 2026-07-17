import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, SpineVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../projectStore';

const projectId = 'data-proposal-project';
const spine: SpineVersion = {
    id: 'spine-2', projectId, promptText: 'Plan', responseText: 'Use local-only records without synchronization.',
    createdAt: 2, isLatest: true, isFinal: true,
};
const artifact: Artifact = {
    id: 'data', projectId, type: 'core_artifact', subtype: 'data_model', title: 'Data model', status: 'active',
    currentVersionId: 'data-v1', createdAt: 1, updatedAt: 1,
};
const content = `# Data Model

## SyncCursor
Tracks obsolete cloud synchronization state.

| Field | Type | Required | Description |
|---|---|---|---|
| cloud_sync_id | string | No | Cloud cursor |
| local_id | string | Yes | Local record |

## PersonalPreference
Manual settings remain unchanged.

| Field | Type | Required | Description |
|---|---|---|---|
| theme | string | No | Selected theme |
`;
const version: ArtifactVersion = {
    id: 'data-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null, content,
    metadata: { manual: 'preserve' }, sourceRefs: [], generationPrompt: 'original', isPreferred: true, createdAt: 1,
};
const item: DownstreamUpdatePlanItem = {
    id: 'sync-field', region: { kind: 'data_model', entityName: 'SyncCursor', aspect: 'field', memberName: 'cloud_sync_id' },
    currentInterpretation: 'Cloud cursor remains.', whyAffected: 'Removed feature: Cloud synchronization.', certainty: 'definite',
    evidence: [{ id: 'e1', kind: 'structured_trace', quality: 'direct', summary: 'Exact field trace.' }],
    recommendedAction: 'review_field', recommendation: 'Remove the exact obsolete field.',
    preservedScope: ['SyncCursor.local_id', 'Entity: PersonalPreference'], recommendedPriority: 1, implementationCritical: true,
};
const makePlan = () => sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'data-plan', projectId, authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Cloud synchronization removed.', targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText), planningContextHash: downstreamPlanningContextHash([]),
        confirmed: true,
    },
    artifact: {
        artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(content),
        slot: 'data_model', title: artifact.title,
    },
    items: [item], preservedArtifactSummary: 'Only cloud_sync_id is affected.',
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, artifacts: { [projectId]: [artifact] },
        artifactVersions: { [projectId]: [version] }, planningRecords: { [projectId]: [] },
        downstreamUpdatePlans: {}, downstreamUpdatePlanEvents: {}, downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {}, downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {}, downstreamArtifactUpdateVerificationEvents: {}, historyEvents: {},
    });
});

describe('data-model proposal store integration', () => {
    it('uses the existing single-use authority and atomic child-version boundary', () => {
        const plan = makePlan();
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan)).toEqual({ ok: true, duplicate: false });
        const generated = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, item.id);
        expect(generated).toMatchObject({ status: 'generated', operation: 'remove' });
        if (generated.status !== 'generated') return;
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, generated.proposalId, { action: 'accepted' }))
            .toMatchObject({ ok: true });
        const applied = useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId);
        expect(applied).toMatchObject({ status: 'applied' });
        if (applied.status !== 'applied') return;
        const state = useProjectStore.getState();
        const child = state.artifactVersions[projectId].find(candidate => candidate.id === applied.artifactVersionId)!;
        expect(child.parentVersionId).toBe(version.id);
        expect(child.content).not.toContain('cloud_sync_id');
        expect(child.content.split('## PersonalPreference')[1]).toBe(content.split('## PersonalPreference')[1]);
        expect(state.artifactVersions[projectId].find(candidate => candidate.id === version.id)?.content).toBe(content);
        expect(state.downstreamArtifactUpdateApplications[projectId]).toHaveLength(1);
        expect(state.downstreamArtifactUpdateVerifications[projectId]).toHaveLength(1);
        expect(state.downstreamArtifactUpdateVerifications[projectId][0]).toMatchObject({ result: 'aligned' });
        expect(state.applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId))
            .toEqual({ status: 'rejected', reason: 'stale' });
    });

    it('fails closed after concurrent content changes and leaves no partial history', () => {
        const plan = makePlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        const generated = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, item.id);
        if (generated.status !== 'generated') throw new Error('proposal expected');
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, generated.proposalId, { action: 'accepted' });
        useProjectStore.setState({
            artifactVersions: { [projectId]: [{ ...version, content: content.replace('Cloud cursor', 'Edited concurrently') }] },
        });
        expect(useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId))
            .toEqual({ status: 'rejected', reason: 'stale' });
        expect(useProjectStore.getState().artifactVersions[projectId]).toHaveLength(1);
        expect(useProjectStore.getState().downstreamArtifactUpdateApplications[projectId] ?? []).toEqual([]);
        expect(useProjectStore.getState().historyEvents[projectId] ?? []).toEqual([]);
    });

    it('preserves earlier proposal history when user context creates a new exact proposal', () => {
        const plan = makePlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        const first = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, item.id);
        if (first.status !== 'generated') throw new Error('proposal expected');
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, first.proposalId, {
            action: 'provided_context',
            context: JSON.stringify({
                changeKind: 'requiredness', memberKind: 'field',
                content: { name: 'cloud_sync_id', type: 'string', required: true, description: 'Temporary migration cursor' },
            }),
        });
        const second = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, item.id);
        expect(second).toMatchObject({ status: 'generated', operation: 'replace' });
        if (second.status !== 'generated') return;
        expect(second.proposalId).not.toBe(first.proposalId);
        expect(useProjectStore.getState().downstreamArtifactUpdateProposals[projectId]).toHaveLength(2);
        expect(useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId]).toHaveLength(1);
    });
});
