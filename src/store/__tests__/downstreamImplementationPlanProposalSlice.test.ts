import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion, StructuredImplementationPlan } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import { extractStructuredPlan } from '../../lib/services/implementationPlanParser';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../projectStore';

const projectId = 'implementation-plan-project';
const structured: StructuredImplementationPlan = {
    milestones: [{ id: 'foundation', name: 'Foundation', tasks: [{ id: 'local', title: 'Build local editor', status: 'todo' }] }],
    architecture: ['Local-only storage.'],
};
const content = `# Implementation Plan\n\n\`\`\`json synapse-plan\n${JSON.stringify(structured, null, 2)}\n\`\`\``;
const artifact: Artifact = {
    id: 'implementation', projectId, type: 'core_artifact', subtype: 'implementation_plan', title: 'Implementation Plan',
    status: 'active', currentVersionId: 'implementation-v1', createdAt: 1, updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'implementation-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null, content,
    metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};
const spine: SpineVersion = {
    id: 'spine-2', projectId, promptText: 'Plan', responseText: 'Security must precede implementation.',
    createdAt: 2, isLatest: true, isFinal: true,
};
const record: PlanningRecord = {
    id: 'security-decision', projectId, type: 'decision', status: 'confirmed', title: 'Security prerequisite',
    statement: 'Security review is required.', resolution: 'Add a prerequisite.', evidence: [], sourceFindingIds: [],
    createdBy: 'user', createdAt: 1, updatedAt: 1,
};

const plan = sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'implementation-update-plan', projectId, authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Security prerequisite confirmed.', targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText), planningContextHash: downstreamPlanningContextHash([record]),
        planningRecordId: record.id, confirmed: true,
    },
    artifact: {
        artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(content),
        slot: 'implementation_plan', title: artifact.title,
    },
    items: [{
        id: 'foundation-prerequisite',
        region: {
            kind: 'implementation_plan', section: 'delivery', aspect: 'milestone', collection: 'milestones',
            milestoneId: 'foundation', entryIndex: 0, entryLabel: 'Foundation', label: 'Foundation',
        },
        currentInterpretation: 'Foundation', whyAffected: 'Security must precede implementation.', certainty: 'possible',
        evidence: [{ id: 'e1', kind: 'plan_diff', quality: 'incomplete', summary: 'User must supply the exact prerequisite.' }],
        recommendedAction: 'review_implementation_plan', recommendation: 'Review the exact milestone.',
        preservedScope: ['Local editor task'], recommendedPriority: 1, implementationCritical: false,
    }],
    preservedArtifactSummary: 'Only the prerequisite needs review.',
});

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, planningRecords: { [projectId]: [record] },
        artifacts: { [projectId]: [artifact] }, artifactVersions: { [projectId]: [version] },
        downstreamUpdatePlans: {}, downstreamUpdatePlanEvents: {}, downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {}, downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {}, downstreamArtifactUpdateVerificationEvents: {}, historyEvents: {},
    });
});

describe('implementation-plan proposal store lifecycle', () => {
    it('keeps generated guidance review-only until user context authorizes an exact prerequisite addition', () => {
        const store = useProjectStore.getState();
        expect(store.recordDownstreamUpdatePlan(projectId, plan)).toMatchObject({ ok: true });
        const initial = store.generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(initial).toMatchObject({ status: 'generated', operation: 'review_only' });
        if (initial.status !== 'generated') return;
        const context = 'add: {"collection":"dependencies","value":"security-review"}';
        expect(store.appendDownstreamArtifactUpdateReviewEvent(projectId, initial.proposalId, { action: 'provided_context', context }))
            .toMatchObject({ ok: true });
        const grounded = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(grounded).toMatchObject({ status: 'generated', operation: 'add' });
        if (grounded.status !== 'generated') return;
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, grounded.proposalId, { action: 'accepted' }))
            .toMatchObject({ ok: true });
        const applied = useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, grounded.proposalId);
        expect(applied).toMatchObject({ status: 'applied' });
        if (applied.status !== 'applied') return;
        const current = useProjectStore.getState().artifactVersions[projectId]
            .find(candidate => candidate.id === applied.artifactVersionId)!;
        expect(extractStructuredPlan(current.content)?.milestones[0].dependencies).toEqual(['security-review']);
        expect(useProjectStore.getState().downstreamArtifactUpdateApplications[projectId]).toHaveLength(1);
        expect(useProjectStore.getState().verifyDownstreamArtifactUpdateItem(projectId, plan.id, plan.items[0].id))
            .toMatchObject({ status: 'verified', result: 'review_recommended' });
    });
});
