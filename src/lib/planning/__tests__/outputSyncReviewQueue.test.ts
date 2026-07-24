import { describe, expect, it } from 'vitest';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    sealDownstreamArtifactUpdateReviewEvent,
} from '../downstreamArtifactUpdateProposal';
import {
    buildDownstreamUpdatePlanCurrentContext,
    downstreamPlanningContextHash,
    sealDownstreamUpdatePlan,
} from '../downstreamUpdatePlan';
import { deriveScreenFlowArtifactUpdateProposal } from '../screenFlowArtifactUpdates';
import { projectOutputSyncReviewQueue } from '../outputSyncReviewQueue';

const projectId = 'queue-project';
const spine: SpineVersion = {
    id: 'spine-2',
    projectId,
    promptText: 'Plan',
    responseText: 'Local-only storage',
    createdAt: 2,
    isLatest: true,
    isFinal: true,
};
const artifact: Artifact = {
    id: 'screens',
    projectId,
    type: 'core_artifact',
    subtype: 'screen_inventory',
    title: 'Screen Inventory',
    status: 'active',
    currentVersionId: 'screens-v1',
    createdAt: 1,
    updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'screens-v1',
    artifactId: artifact.id,
    versionNumber: 1,
    parentVersionId: null,
    content: JSON.stringify({
        sections: [{
            title: 'Core',
            screens: [{
                id: 'workspace',
                name: 'Workspace',
                priority: 'P0',
                purpose: 'Edit',
                states: [{ name: 'Syncing', description: 'Uploads data' }],
            }],
        }],
    }),
    metadata: {},
    sourceRefs: [],
    generationPrompt: '',
    isPreferred: true,
    createdAt: 1,
};
const record: PlanningRecord = {
    id: 'decision',
    projectId,
    type: 'decision',
    status: 'confirmed',
    title: 'Storage',
    statement: 'Storage',
    resolution: 'Local only',
    evidence: [],
    sourceFindingIds: [],
    createdBy: 'user',
    createdAt: 1,
    updatedAt: 1,
};
const plan = sealDownstreamUpdatePlan({
    schemaVersion: 1,
    id: 'plan',
    projectId,
    authoredBy: 'synapse',
    source: {
        kind: 'planning_change',
        summary: 'Storage became local only.',
        targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText),
        planningContextHash: downstreamPlanningContextHash([record]),
        confirmed: true,
    },
    artifact: {
        artifactId: artifact.id,
        artifactVersionId: version.id,
        artifactContentHash: hashReviewValue(version.content),
        slot: 'screen_inventory',
        title: artifact.title,
    },
    items: [{
        id: 'item',
        region: {
            kind: 'screen',
            screenId: 'workspace',
            screenName: 'Workspace',
            aspect: 'state',
            aspectId: 'syncing',
            label: 'Syncing',
        },
        currentInterpretation: 'The screen uploads data.',
        whyAffected: 'The current plan is local only.',
        certainty: 'definite',
        evidence: [{ id: 'evidence', kind: 'structured_trace', quality: 'direct', summary: 'Exact state.' }],
        recommendedAction: 'remove_obsolete_element',
        recommendation: 'Remove cloud sync.',
        preservedScope: ['Local editing'],
        recommendedPriority: 1,
        implementationCritical: true,
    }],
    preservedArtifactSummary: 'Only the syncing state is affected.',
    createdAt: 10,
});
const derived = deriveScreenFlowArtifactUpdateProposal({
    projectId,
    plan,
    item: plan.items[0],
    artifactVersion: version,
    createdAt: 20,
});
if (!derived.ok) throw new Error(derived.reason);
const proposal = derived.proposal;
const context = buildDownstreamUpdatePlanCurrentContext({
    spineVersions: [spine],
    planningRecords: [record],
    artifacts: [artifact],
    artifactVersions: [version],
})!;

describe('output sync review queue projection', () => {
    it('projects a current unreviewed exact-region proposal', () => {
        expect(projectOutputSyncReviewQueue({
            plans: [plan],
            proposals: [proposal],
            reviewEvents: [],
            artifactVersions: [version],
            context,
        })).toEqual([expect.objectContaining({
            proposalId: proposal.id,
            planId: plan.id,
            itemId: plan.items[0].id,
            artifactTitle: 'Screen Inventory',
            regionLabel: 'Workspace · Syncing',
            operation: 'remove',
            certainty: 'definite',
        })]);
    });

    it('excludes stale and already-reviewed proposals', () => {
        const staleContext = { ...context, spineVersionId: 'spine-3' };
        expect(projectOutputSyncReviewQueue({
            plans: [plan],
            proposals: [proposal],
            reviewEvents: [],
            artifactVersions: [version],
            context: staleContext,
        })).toEqual([]);

        const review = sealDownstreamArtifactUpdateReviewEvent({
            schemaVersion: 1,
            id: 'review',
            projectId,
            proposalId: proposal.id,
            actor: 'user',
            action: 'accepted',
            at: 30,
            expectedProposalIntegrityHash: proposal.integrityHash,
            expectedPlanIntegrityHash: plan.integrityHash,
            expectedItemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, plan.items[0]),
            expectedRegionContentHash: proposal.currentRegionContentHash,
        });
        expect(projectOutputSyncReviewQueue({
            plans: [plan],
            proposals: [proposal],
            reviewEvents: [review],
            artifactVersions: [version],
            context,
        })).toEqual([]);
    });
});
