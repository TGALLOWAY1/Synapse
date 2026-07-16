import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    sealDownstreamArtifactUpdateProposal,
} from '../../lib/planning/downstreamArtifactUpdateProposal';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import { resolveDownstreamUpdateRegionContent } from '../../lib/planning/downstreamRegionContent';
import { useProjectStore } from '../../store/projectStore';
import { DownstreamArtifactUpdateProposalReview } from '../downstream/DownstreamArtifactUpdateProposalReview';

const projectId = 'proposal-ui-project';
const spine: SpineVersion = {
    id: 'spine', projectId, promptText: 'Plan', responseText: 'Local only', createdAt: 1, isLatest: true, isFinal: true,
};
const record: PlanningRecord = {
    id: 'decision', projectId, type: 'decision', status: 'confirmed', title: 'Storage', statement: 'Storage',
    resolution: 'Local only', evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
};
const artifact: Artifact = {
    id: 'screens', projectId, type: 'core_artifact', subtype: 'screen_inventory', title: 'Screens',
    status: 'active', currentVersionId: 'v1', createdAt: 1, updatedAt: 1,
};
const version: ArtifactVersion = {
    id: 'v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null,
    content: JSON.stringify({ sections: [{ title: 'Core', screens: [{
        id: 'workspace', name: 'Workspace', purpose: 'Cloud sync', states: [],
    }] }] }), metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};
const plan = sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan', projectId, authoredBy: 'synapse', createdAt: 2,
    source: {
        kind: 'planning_change', summary: 'Local only', targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText), planningContextHash: downstreamPlanningContextHash([record]), confirmed: true,
    },
    artifact: {
        artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(version.content),
        slot: 'screen_inventory', title: artifact.title,
    },
    items: [{
        id: 'item', region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'screen' },
        currentInterpretation: 'Cloud sync', whyAffected: 'Local only', certainty: 'definite',
        evidence: [{ id: 'e', kind: 'structured_trace', quality: 'direct', summary: 'Exact screen' }],
        recommendedAction: 'revise_behavior', recommendation: 'Use local behavior', preservedScope: [],
        recommendedPriority: 1, implementationCritical: true,
    }], preservedArtifactSummary: 'Other screens remain unchanged.',
});
const region = resolveDownstreamUpdateRegionContent(version, plan.items[0].region);
const proposal = sealDownstreamArtifactUpdateProposal({
    schemaVersion: 1, id: 'proposal', projectId, authoredBy: 'synapse',
    updatePlanBinding: {
        planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: plan.items[0].id,
        itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, plan.items[0]),
    },
    source: plan.source, artifact: plan.artifact, region: plan.items[0].region,
    regionKey: downstreamUpdateRegionKey(plan.items[0].region), currentRegionContentHash: region.contentHash!,
    currentRegionSnapshot: region.snapshot!, currentRegionSnapshotTruncated: false,
    operation: 'replace', proposedContent: '{"purpose":"Local work"}', evidence: plan.items[0].evidence,
    reasoning: 'Revise only the exact screen.', certainty: 'definite', preservedScope: [],
    preservedScopeHash: hashReviewValue([]), preservedRegionBindings: [],
    generator: { provider: 'synapse', model: 'bounded', promptHash: 'hash', reasoningVersion: 'v1' }, createdAt: 3,
});

beforeEach(() => {
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, planningRecords: { [projectId]: [record] },
        artifacts: { [projectId]: [artifact] }, artifactVersions: { [projectId]: [version] },
        downstreamUpdatePlans: { [projectId]: [plan] }, downstreamUpdatePlanEvents: {},
        downstreamArtifactUpdateProposals: { [projectId]: [proposal] }, downstreamArtifactUpdateReviewEvents: {},
        downstreamArtifactUpdateApplications: {}, downstreamArtifactUpdateVerifications: {}, downstreamArtifactUpdateVerificationEvents: {},
    });
});

describe('DownstreamArtifactUpdateProposalReview authority currentness', () => {
    it('closes approval immediately when the artifact current version changes', async () => {
        render(<DownstreamArtifactUpdateProposalReview projectId={projectId} plan={plan} item={plan.items[0]} readOnly={false} />);
        expect(screen.getByRole('button', { name: 'Accept proposal' })).toBeInTheDocument();
        const next = { ...version, id: 'v2', versionNumber: 2, parentVersionId: version.id, isPreferred: true, createdAt: 4 };
        useProjectStore.setState({
            artifacts: { [projectId]: [{ ...artifact, currentVersionId: next.id }] },
            artifactVersions: { [projectId]: [{ ...version, isPreferred: false }, next] },
        });
        await waitFor(() => expect(screen.getByText(/Historical proposal/)).toBeInTheDocument());
        expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument();
    });

    it('ignores a forged proposal instead of displaying approval or applied authority', () => {
        useProjectStore.setState({
            downstreamArtifactUpdateProposals: { [projectId]: [{ ...proposal, reasoning: 'tampered' }] },
        });
        render(<DownstreamArtifactUpdateProposalReview projectId={projectId} plan={plan} item={plan.items[0]} readOnly={false} />);
        expect(screen.getByText(/failed integrity checks and was ignored/)).toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Applied in version/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Synapse verification:/)).not.toBeInTheDocument();
    });

    it('does not display forged application or aligned-verification authority', () => {
        useProjectStore.setState({
            downstreamArtifactUpdateApplications: { [projectId]: [{
                schemaVersion: 1, id: 'forged-app', projectId, proposalId: proposal.id,
                proposalIntegrityHash: proposal.integrityHash, authorizedByReviewEventId: 'missing-review',
                authorizedByReviewEventIntegrityHash: 'missing', actor: 'system', initiatedBy: 'user',
                effectiveOperation: 'replace', effectiveContentHash: 'content', expectedArtifactVersionId: version.id,
                expectedArtifactContentHash: hashReviewValue(version.content), expectedRegionContentHash: region.contentHash!,
                resultingArtifactVersionId: version.id, resultingArtifactContentHash: hashReviewValue(version.content),
                resultingRegionContentHash: region.contentHash!, appliedAt: 4, integrityHash: 'forged',
            } as never] },
            downstreamArtifactUpdateVerifications: { [projectId]: [{
                schemaVersion: 1, id: 'forged-verification', projectId, authoredBy: 'synapse', result: 'aligned',
                evidence: [], reasoning: 'Forged alignment', verifiedArtifactVersionId: version.id,
                verifiedArtifactContentHash: hashReviewValue(version.content), verifiedRegionContentHash: region.contentHash!,
                generator: { provider: 'synapse', model: 'forged', promptHash: 'x', reasoningVersion: 'x' },
                createdAt: 5, integrityHash: 'forged',
                subject: {
                    kind: 'application', planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: plan.items[0].id,
                    itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, plan.items[0]),
                    sourceSpineVersionId: spine.id, sourceSpineContentHash: hashReviewValue(spine.responseText),
                    planningContextHash: downstreamPlanningContextHash([record]), artifactId: artifact.id,
                    baselineArtifactVersionId: version.id, baselineArtifactContentHash: hashReviewValue(version.content),
                    targetArtifactVersionId: version.id, targetArtifactContentHash: hashReviewValue(version.content),
                    proposalId: proposal.id, proposalIntegrityHash: proposal.integrityHash,
                    applicationId: 'forged-app', applicationIntegrityHash: 'forged',
                },
            } as never] },
        });
        render(<DownstreamArtifactUpdateProposalReview projectId={projectId} plan={plan} item={plan.items[0]} readOnly={false} />);
        expect(screen.getByText(/lifecycle records failed integrity checks/)).toBeInTheDocument();
        expect(screen.queryByText(/Applied in version/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Synapse verification:/)).not.toBeInTheDocument();
    });
});
