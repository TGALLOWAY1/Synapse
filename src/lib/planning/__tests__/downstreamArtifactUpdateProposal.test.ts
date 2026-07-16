import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import {
    compareDownstreamArtifactUpdateProposalCurrentness,
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    effectiveDownstreamArtifactUpdate,
    latestDownstreamArtifactUpdateReview,
    latestDownstreamArtifactUpdateVerificationReview,
    normalizeDownstreamArtifactUpdateProposalCollections,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateApplication,
    sealDownstreamArtifactUpdateProposal,
    sealDownstreamArtifactUpdateReviewEvent,
    sealDownstreamArtifactUpdateVerification,
    sealDownstreamArtifactUpdateVerificationEvent,
    validateDownstreamArtifactUpdateApplicationIntegrity,
    validateDownstreamArtifactUpdateProposalIntegrity,
    validateDownstreamArtifactUpdateReviewEventIntegrity,
    validateDownstreamArtifactUpdateVerificationEventIntegrity,
    validateDownstreamArtifactUpdateVerificationIntegrity,
    type DownstreamArtifactUpdateProposal,
} from '../downstreamArtifactUpdateProposal';
import { sealDownstreamUpdatePlan, type DownstreamUpdatePlan } from '../downstreamUpdatePlan';

const screenContent = JSON.stringify({ sections: [{ title: 'Core', screens: [{
    id: 'workspace', name: 'Workspace', priority: 'P0', purpose: 'Cloud collaboration', userIntent: 'Edit together',
    states: [{ name: 'Syncing', description: 'Uploads changes' }], coreUIElements: ['Canvas'], exitPaths: [],
}]}] });
const artifactVersion: ArtifactVersion = {
    id: 'screens-v1', artifactId: 'screens', versionNumber: 1, parentVersionId: null, content: screenContent,
    metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};

const makePlan = (): DownstreamUpdatePlan => sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan-1', projectId: 'p1', authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Cloud collaboration was removed.', sourceSpineVersionId: 'spine-1',
        targetSpineVersionId: 'spine-2', targetSpineContentHash: 'spine-hash-2', planningContextHash: 'context-1',
        planningRecordId: 'decision-1', planningEventId: 'event-1', confirmed: true,
    },
    artifact: {
        artifactId: 'screens', artifactVersionId: artifactVersion.id,
        artifactContentHash: hashReviewValue(artifactVersion.content), slot: 'screen_inventory', title: 'Screens',
    },
    items: [{
        id: 'item-1', region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'state', aspectId: 'syncing', label: 'Syncing' },
        currentInterpretation: 'Workspace uploads changes.', whyAffected: 'Cloud sync was removed.', certainty: 'definite',
        evidence: [{ id: 'e1', kind: 'structured_trace', quality: 'direct', summary: 'The state traces to sync.' }],
        recommendedAction: 'remove_obsolete_element', recommendation: 'Remove the obsolete sync state.',
        ambiguity: 'Offline recovery may still need a state.', preservedScope: ['Workspace canvas'], recommendedPriority: 1,
        implementationCritical: true,
    }],
    preservedArtifactSummary: 'Only Syncing needs review.',
});

const makeProposal = (plan = makePlan()): DownstreamArtifactUpdateProposal => {
    const item = plan.items[0];
    const region = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
    const preservedRegion = { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'role' } as const;
    const preserved = resolveDownstreamUpdateRegionContent(artifactVersion, preservedRegion);
    return sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1, id: 'proposal-1', projectId: 'p1', authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source, artifact: plan.artifact, region: item.region, regionKey: downstreamUpdateRegionKey(item.region),
        currentRegionContentHash: region.contentHash!, currentRegionSnapshot: region.snapshot!,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated), operation: 'remove', proposedContent: null,
        evidence: item.evidence, reasoning: 'The exact Syncing state conflicts with the local-only plan.', certainty: item.certainty,
        ambiguity: item.ambiguity, preservedScope: item.preservedScope, preservedScopeHash: hashReviewValue(item.preservedScope),
        preservedRegionBindings: [{
            region: preservedRegion, regionKey: downstreamUpdateRegionKey(preservedRegion), contentHash: preserved.contentHash!,
        }],
        generator: { provider: 'openai', model: 'reasoner', promptHash: 'prompt-1', reasoningVersion: 'phase-5.1' }, createdAt: 20,
    });
};

const context = {
    spineVersionId: 'spine-2', spineContentHash: 'spine-hash-2', planningContextHash: 'context-1',
    artifactVersions: { screens: { versionId: 'screens-v1', contentHash: hashReviewValue(screenContent) } },
};

describe('bounded downstream artifact-update proposal contract', () => {
    it('binds the exact plan item, planning spine, artifact, and current region snapshot', () => {
        const plan = makePlan();
        const proposal = makeProposal(plan);
        expect(validateDownstreamArtifactUpdateProposalIntegrity(proposal)).toBe(true);
        expect(proposal.currentRegionSnapshot).toContain('Uploads changes');
        expect(compareDownstreamArtifactUpdateProposalCurrentness({ proposal, plan, planContext: context, artifactVersion }))
            .toEqual({ current: true, reasons: [] });

        const changedContent = artifactVersion.content.replace('Uploads changes', 'Saves locally');
        expect(compareDownstreamArtifactUpdateProposalCurrentness({
            proposal, plan, planContext: context, artifactVersion: { ...artifactVersion, content: changedContent },
        }).reasons).toEqual(expect.arrayContaining(['artifact_content_changed', 'region_content_changed']));
        expect(compareDownstreamArtifactUpdateProposalCurrentness({
            proposal, plan, planContext: { ...context, spineVersionId: 'spine-3' }, artifactVersion,
        }).reasons).toContain('spine_changed');
        const changedPreserved = artifactVersion.content.replace('Cloud collaboration', 'Enterprise administration');
        expect(compareDownstreamArtifactUpdateProposalCurrentness({
            proposal, plan, planContext: context, artifactVersion: { ...artifactVersion, content: changedPreserved },
        }).reasons).toContain('preserved_region_changed');
    });

    it('detects proposal, item, source, preserved-scope, and snapshot tampering', () => {
        const plan = makePlan();
        const proposal = makeProposal(plan);
        expect(validateDownstreamArtifactUpdateProposalIntegrity({ ...proposal, reasoning: 'Delete everything.' })).toBe(false);
        expect(validateDownstreamArtifactUpdateProposalIntegrity({ ...proposal, preservedScope: [] })).toBe(false);
        expect(validateDownstreamArtifactUpdateProposalIntegrity({ ...proposal, currentRegionSnapshot: 'Different' })).toBe(false);

        const changedPlan = sealDownstreamUpdatePlan({ ...plan, items: [{ ...plan.items[0], recommendation: 'Keep it.' }] });
        expect(compareDownstreamArtifactUpdateProposalCurrentness({ proposal, plan: changedPlan, planContext: context, artifactVersion }).reasons)
            .toEqual(expect.arrayContaining(['plan_changed', 'item_changed']));
    });

    it('forces imprecise artifact reviews to remain non-applicable review-only proposals', () => {
        const base = makeProposal();
        const broadRegion = { kind: 'artifact_review', reason: 'legacy_provenance', label: 'Screens' } as const;
        const broadContent = resolveDownstreamUpdateRegionContent(artifactVersion, broadRegion);
        const { integrityHash: _baseIntegrity, ...baseInput } = base;
        void _baseIntegrity;
        const unsafe = sealDownstreamArtifactUpdateProposal({
            ...baseInput, region: broadRegion, regionKey: downstreamUpdateRegionKey(broadRegion),
            currentRegionContentHash: broadContent.contentHash!, currentRegionSnapshot: broadContent.snapshot!,
            currentRegionSnapshotTruncated: Boolean(broadContent.snapshotTruncated),
            operation: 'replace', proposedContent: 'new artifact',
        });
        expect(validateDownstreamArtifactUpdateProposalIntegrity(unsafe)).toBe(false);
        const sourcePlan = makePlan();
        const broadPlan = sealDownstreamUpdatePlan({
            ...sourcePlan,
            items: [{ ...sourcePlan.items[0], region: broadRegion, certainty: 'possible', recommendedAction: 'review_only' }],
        });
        const reviewOnly = sealDownstreamArtifactUpdateProposal({
            ...baseInput, id: 'review-only', source: broadPlan.source, artifact: broadPlan.artifact,
            updatePlanBinding: {
                planId: broadPlan.id, planIntegrityHash: broadPlan.integrityHash, itemId: broadPlan.items[0].id,
                itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(broadPlan, broadPlan.items[0]),
            },
            region: broadRegion, regionKey: downstreamUpdateRegionKey(broadRegion),
            currentRegionContentHash: broadContent.contentHash!, currentRegionSnapshot: broadContent.snapshot!,
            currentRegionSnapshotTruncated: Boolean(broadContent.snapshotTruncated), operation: 'review_only', proposedContent: null,
        });
        expect(validateDownstreamArtifactUpdateProposalIntegrity(reviewOnly)).toBe(true);
        expect(compareDownstreamArtifactUpdateProposalCurrentness({
            proposal: reviewOnly, plan: broadPlan, planContext: context, artifactVersion,
        }).current).toBe(true);
    });

    it('keeps generated proposals advisory and derives authority only from exact user review events', () => {
        const proposal = makeProposal();
        const accepted = sealDownstreamArtifactUpdateReviewEvent({
            schemaVersion: 1, id: 'review-1', projectId: 'p1', proposalId: proposal.id, actor: 'user', at: 30,
            expectedProposalIntegrityHash: proposal.integrityHash,
            expectedPlanIntegrityHash: proposal.updatePlanBinding.planIntegrityHash,
            expectedItemIntegrityHash: proposal.updatePlanBinding.itemIntegrityHash,
            expectedRegionContentHash: proposal.currentRegionContentHash, action: 'accepted',
        });
        expect(validateDownstreamArtifactUpdateReviewEventIntegrity(accepted)).toBe(true);
        expect(validateDownstreamArtifactUpdateReviewEventIntegrity({ ...accepted, actor: 'synapse' } as never)).toBe(false);
        expect(latestDownstreamArtifactUpdateReview(proposal, [accepted])?.id).toBe(accepted.id);
        expect(effectiveDownstreamArtifactUpdate(proposal, accepted)).toEqual({ operation: 'remove', contentHash: null });

        const { integrityHash: _acceptedIntegrity, ...acceptedBase } = accepted;
        void _acceptedIntegrity;
        const edited = sealDownstreamArtifactUpdateReviewEvent({
            ...acceptedBase, id: 'review-2', at: 31, action: 'edited', operation: 'replace',
            editedContent: '{"name":"Offline"}', rationale: 'Keep an explicit local recovery state.',
        });
        expect(effectiveDownstreamArtifactUpdate(proposal, edited)).toEqual({
            operation: 'replace', contentHash: hashReviewValue('{"name":"Offline"}'),
        });
        expect(latestDownstreamArtifactUpdateReview(proposal, [accepted, edited])?.id).toBe(edited.id);
    });

    it('seals application and verification history separately without granting model approval', () => {
        const proposal = makeProposal();
        const application = sealDownstreamArtifactUpdateApplication({
            schemaVersion: 1, id: 'application-1', projectId: 'p1', proposalId: proposal.id,
            proposalIntegrityHash: proposal.integrityHash, authorizedByReviewEventId: 'review-1',
            authorizedByReviewEventIntegrityHash: 'review-hash', actor: 'system', initiatedBy: 'user',
            effectiveOperation: 'remove', effectiveContentHash: null, expectedArtifactVersionId: 'screens-v1',
            expectedArtifactContentHash: proposal.artifact.artifactContentHash,
            expectedRegionContentHash: proposal.currentRegionContentHash, resultingArtifactVersionId: 'screens-v2',
            resultingArtifactContentHash: 'result-hash', resultingRegionContentHash: 'region-result', appliedAt: 40,
        });
        expect(validateDownstreamArtifactUpdateApplicationIntegrity(application)).toBe(true);
        expect(validateDownstreamArtifactUpdateApplicationIntegrity({ ...application, initiatedBy: 'synapse' } as never)).toBe(false);

        const verification = sealDownstreamArtifactUpdateVerification({
            schemaVersion: 1, id: 'verification-1', projectId: 'p1', proposalId: proposal.id,
            proposalIntegrityHash: proposal.integrityHash, applicationId: application.id,
            applicationIntegrityHash: application.integrityHash, authoredBy: 'synapse', result: 'matches_proposal',
            evidence: [], reasoning: 'The obsolete state is absent.', verifiedArtifactVersionId: 'screens-v2',
            verifiedArtifactContentHash: 'result-hash', verifiedRegionContentHash: 'region-result',
            generator: proposal.generator, createdAt: 50,
        });
        expect(validateDownstreamArtifactUpdateVerificationIntegrity(verification)).toBe(true);
        const userEvent = sealDownstreamArtifactUpdateVerificationEvent({
            schemaVersion: 1, id: 'verification-review', projectId: 'p1', verificationId: verification.id,
            actor: 'user', action: 'confirmed', expectedVerificationIntegrityHash: verification.integrityHash, at: 60,
        });
        expect(validateDownstreamArtifactUpdateVerificationEventIntegrity(userEvent)).toBe(true);
        expect(validateDownstreamArtifactUpdateVerificationEventIntegrity({ ...userEvent, actor: 'synapse' } as never)).toBe(false);
        expect(latestDownstreamArtifactUpdateVerificationReview(verification, [
            userEvent,
            { ...userEvent, id: 'model-review', actor: 'synapse' } as never,
        ])?.id).toBe(userEvent.id);
    });

    it('resolves exact screen, flow, current markdown data-model, and legacy JSON regions conservatively', () => {
        expect(resolveDownstreamUpdateRegionContent(artifactVersion, makePlan().items[0].region).found).toBe(true);
        const flow = { content: '### Flow: Publish\n**Steps:**\n1. Draft post\n   - **Decision:** If private → save locally\n2. Publish\n**Success Outcome:** Done' };
        expect(resolveDownstreamUpdateRegionContent(flow, {
            kind: 'flow', flowId: 'publish', flowName: 'Publish', aspect: 'step', stepIndex: 0,
        })).toMatchObject({ found: true });
        const markdown = { content: '## Workspace\nA project.\n\n### Key Product Fields\n| Field | Type | Required | Description |\n|---|---|---|---|\n| name | string | yes | Name |' };
        expect(resolveDownstreamUpdateRegionContent(markdown, {
            kind: 'data_model', entityName: 'Workspace', aspect: 'field', memberName: 'name',
        })).toMatchObject({ found: true });
        const legacy = { content: JSON.stringify({ entities: [{ name: 'Workspace', fields: [{ name: 'name', type: 'string' }], relationships: [], constraints: [] }] }) };
        expect(resolveDownstreamUpdateRegionContent(legacy, {
            kind: 'data_model', entityName: 'Workspace', aspect: 'field', memberName: 'name',
        })).toMatchObject({ found: true });
        expect(resolveDownstreamUpdateRegionContent(legacy, {
            kind: 'data_model', entityName: 'Missing', aspect: 'entity',
        })).toEqual({ found: false });
    });

    it('provides conservative empty defaults for legacy projects', () => {
        const empty = { proposals: {}, reviewEvents: {}, applications: {}, verifications: {}, verificationEvents: {} };
        expect(normalizeDownstreamArtifactUpdateProposalCollections(undefined)).toEqual(empty);
        expect(normalizeDownstreamArtifactUpdateProposalCollections({})).toEqual(empty);
    });
});
