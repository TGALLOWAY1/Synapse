import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Artifact, ArtifactVersion, PlanningRecord, SpineVersion } from '../../types';
import { hashReviewValue } from '../../lib/review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateApplication,
    sealDownstreamArtifactUpdateProposal,
    sealDownstreamArtifactUpdateVerification,
} from '../../lib/planning/downstreamArtifactUpdateProposal';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan } from '../../lib/planning/downstreamUpdatePlan';
import { useProjectStore } from '../projectStore';

const projectId = 'proposal-project';
const spine: SpineVersion = {
    id: 'spine-2', projectId, promptText: 'Plan', responseText: 'Local-only plan', createdAt: 2,
    isLatest: true, isFinal: true,
};
const artifact: Artifact = {
    id: 'screens', projectId, type: 'core_artifact', subtype: 'screen_inventory', title: 'Screens', status: 'active',
    currentVersionId: 'screens-v1', createdAt: 1, updatedAt: 1,
};
const content = (description: string) => JSON.stringify({ sections: [{ title: 'Core', screens: [{
    id: 'workspace', name: 'Workspace', priority: 'P0', purpose: 'Local editing',
    states: [{ name: 'Syncing', description }],
}]}] });
const version: ArtifactVersion = {
    id: 'screens-v1', artifactId: artifact.id, versionNumber: 1, parentVersionId: null,
    content: content('Uploads to cloud'), metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};
const record: PlanningRecord = {
    id: 'decision', projectId, type: 'decision', status: 'confirmed', title: 'Storage', statement: 'Storage choice',
    resolution: 'Local only', evidence: [], sourceFindingIds: [], createdBy: 'user', createdAt: 1, updatedAt: 1,
};

const makePlan = () => sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan-1', projectId, authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Storage became local only.', targetSpineVersionId: spine.id,
        targetSpineContentHash: hashReviewValue(spine.responseText), planningContextHash: downstreamPlanningContextHash([record]),
        planningRecordId: record.id, confirmed: true,
    },
    artifact: {
        artifactId: artifact.id, artifactVersionId: version.id, artifactContentHash: hashReviewValue(version.content),
        slot: 'screen_inventory', title: artifact.title,
    },
    items: [{
        id: 'item-1', region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'state', aspectId: 'syncing', label: 'Syncing' },
        currentInterpretation: 'The screen uploads changes.', whyAffected: 'The plan is local only.', certainty: 'definite',
        evidence: [{ id: 'e1', kind: 'structured_trace', quality: 'direct', summary: 'Exact state.' }],
        ambiguity: 'A save state may remain.', recommendedAction: 'remove_obsolete_element', recommendation: 'Remove cloud sync.',
        preservedScope: ['Workspace editing'], recommendedPriority: 1, implementationCritical: true,
    }], preservedArtifactSummary: 'Only Syncing is affected.',
});

const makeProposal = () => {
    const plan = makePlan();
    const item = plan.items[0];
    const region = resolveDownstreamUpdateRegionContent(version, item.region);
    return { plan, proposal: sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1, id: 'proposal-1', projectId, authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source, artifact: plan.artifact, region: item.region, regionKey: downstreamUpdateRegionKey(item.region),
        currentRegionContentHash: region.contentHash!, currentRegionSnapshot: region.snapshot!,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated), operation: 'remove', proposedContent: null,
        evidence: item.evidence, reasoning: 'Cloud sync contradicts local-only storage.', certainty: 'definite', ambiguity: item.ambiguity,
        preservedScope: item.preservedScope, preservedScopeHash: hashReviewValue(item.preservedScope), preservedRegionBindings: [],
        generator: { provider: 'openai', model: 'reasoner', promptHash: 'prompt', reasoningVersion: 'phase-5.1' }, createdAt: 20,
    }) };
};

beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(Date, 'now').mockReturnValue(100);
    useProjectStore.setState({
        projects: { [projectId]: { id: projectId, name: 'Project', createdAt: 1 } },
        spineVersions: { [projectId]: [spine] }, artifacts: { [projectId]: [artifact] },
        artifactVersions: { [projectId]: [version] }, planningRecords: { [projectId]: [record] },
        downstreamUpdatePlans: {}, downstreamUpdatePlanEvents: {}, downstreamArtifactUpdateProposals: {},
        downstreamArtifactUpdateReviewEvents: {}, downstreamArtifactUpdateApplications: {},
        downstreamArtifactUpdateVerifications: {}, downstreamArtifactUpdateVerificationEvents: {},
        historyEvents: {},
    });
});

describe('downstream artifact-update proposal store boundary', () => {
    it('generates, authorizes, and atomically applies one exact screen-state removal as a new version', () => {
        const plan = makePlan();
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan)).toEqual({ ok: true, duplicate: false });
        const generated = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(generated).toMatchObject({ status: 'generated', operation: 'remove' });
        if (generated.status !== 'generated') return;
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, generated.proposalId, { action: 'accepted' }))
            .toMatchObject({ ok: true });
        const applied = useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId);
        expect(applied).toMatchObject({ status: 'applied' });
        if (applied.status !== 'applied') return;

        const state = useProjectStore.getState();
        const result = state.artifactVersions[projectId].find(candidate => candidate.id === applied.artifactVersionId)!;
        expect(result.parentVersionId).toBe(version.id);
        expect(result.provenance?.changeSource).toBe('user_edit');
        expect(JSON.parse(result.content).sections[0].screens[0].states).toEqual([]);
        expect(state.artifactVersions[projectId].find(candidate => candidate.id === version.id)?.content).toBe(version.content);
        expect(state.downstreamArtifactUpdateApplications[projectId]).toHaveLength(1);
        expect(state.downstreamArtifactUpdateVerifications[projectId]).toHaveLength(1);
        expect(state.downstreamArtifactUpdateVerifications[projectId][0]).toMatchObject({ result: 'aligned' });
        expect(state.historyEvents[projectId].at(-1)).toMatchObject({ type: 'Edited', artifactVersionId: result.id });
        expect(state.downstreamUpdatePlans[projectId][0]).toEqual(plan);
        expect(state.downstreamUpdatePlans[projectId][1]).toMatchObject({
            artifact: { artifactVersionId: result.id },
            items: [],
            rebase: { predecessorPlanId: plan.id, appliedPredecessorItemId: plan.items[0].id },
        });
        expect(state.applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId))
            .toEqual({ status: 'rejected', reason: 'stale' });
    });

    it('rebases untouched siblings so two updates can be applied while defer and reject history remain explicit', () => {
        const stateNames = ['Syncing', 'Collaborating', 'Cloud backup', 'Legacy role'];
        const multiVersion: ArtifactVersion = {
            ...version,
            content: JSON.stringify({ sections: [{ title: 'Core', screens: [{
                id: 'workspace', name: 'Workspace', priority: 'P0', purpose: 'Local editing',
                states: stateNames.map(name => ({ name, description: `${name} behavior` })),
            }] }] }),
        };
        const items = stateNames.map((name, index) => ({
            ...makePlan().items[0],
            id: `item-${index + 1}`,
            region: {
                kind: 'screen' as const, screenId: 'workspace', screenName: 'Workspace',
                aspect: 'state' as const, aspectId: name.toLowerCase().replace(/\s+/g, '-'), label: name,
            },
            currentInterpretation: `${name} remains in the screen.`,
            recommendation: `Remove ${name}.`,
            recommendedPriority: index + 1,
        }));
        const { integrityHash: _basePlanIntegrityHash, ...basePlan } = makePlan();
        void _basePlanIntegrityHash;
        const plan = sealDownstreamUpdatePlan({
            ...basePlan,
            id: 'plan-partial',
            artifact: {
                ...makePlan().artifact,
                artifactContentHash: hashReviewValue(multiVersion.content),
            },
            items,
        });
        useProjectStore.setState({ artifactVersions: { [projectId]: [multiVersion] } });
        expect(useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan)).toMatchObject({ ok: true });

        expect(useProjectStore.getState().appendDownstreamUpdatePlanEvent(projectId, plan.id, items[2].id, {
            type: 'disposition_recorded', disposition: 'deferred', rationale: 'Defer cloud backup until recovery testing.',
        })).toMatchObject({ ok: true });
        const rejected = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, items[3].id);
        expect(rejected.status).toBe('generated');
        if (rejected.status !== 'generated') return;
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, rejected.proposalId, {
            action: 'rejected', rationale: 'Keep the legacy role until migration completes.',
        })).toMatchObject({ ok: true });

        const first = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, items[0].id);
        expect(first.status).toBe('generated');
        if (first.status !== 'generated') return;
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, first.proposalId, { action: 'accepted' });
        expect(useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, first.proposalId)).toMatchObject({ status: 'applied' });

        const afterFirst = useProjectStore.getState();
        const firstRebase = afterFirst.downstreamUpdatePlans[projectId].at(-1)!;
        expect(firstRebase.rebase).toMatchObject({ predecessorPlanId: plan.id, appliedPredecessorItemId: items[0].id });
        expect(firstRebase.items.map(item => item.region.kind === 'screen' ? item.region.label : '')).toEqual([
            'Collaborating', 'Cloud backup', 'Legacy role',
        ]);
        expect(afterFirst.downstreamUpdatePlanEvents[projectId].some(event => (
            event.planId === firstRebase.id && event.type === 'disposition_recorded' && event.disposition === 'deferred' && event.carriedFrom
        ))).toBe(true);
        expect(afterFirst.downstreamArtifactUpdateReviewEvents[projectId].some(event => (
            event.action === 'rejected' && event.carriedFrom?.proposalId === rejected.proposalId
        ))).toBe(true);
        expect(afterFirst.downstreamArtifactUpdateReviewEvents[projectId].some(event => (
            event.action === 'accepted' && Boolean(event.carriedFrom)
        ))).toBe(false);

        const secondItem = firstRebase.items.find(item => item.region.kind === 'screen' && item.region.label === 'Collaborating')!;
        const secondProposal = afterFirst.downstreamArtifactUpdateProposals[projectId].find(candidate => (
            candidate.updatePlanBinding.planId === firstRebase.id
            && candidate.updatePlanBinding.itemId === secondItem.id
        ))!;
        expect(secondProposal.id).not.toBe(first.proposalId);
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, secondProposal.id, { action: 'accepted' }))
            .toMatchObject({ ok: true });
        expect(useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, secondProposal.id))
            .toMatchObject({ status: 'applied' });

        const finalState = useProjectStore.getState();
        const finalVersion = finalState.artifactVersions[projectId].find(candidate => candidate.id === finalState.artifacts[projectId][0].currentVersionId)!;
        expect(JSON.parse(finalVersion.content).sections[0].screens[0].states.map((state: { name: string }) => state.name))
            .toEqual(['Cloud backup', 'Legacy role']);
        expect(finalState.downstreamUpdatePlans[projectId].at(-1)?.items).toHaveLength(2);
        expect(finalState.downstreamArtifactUpdateApplications[projectId]).toHaveLength(2);
        expect(finalState.downstreamArtifactUpdateVerifications[projectId]).toHaveLength(2);
    });

    it('deterministically verifies an authorized exact removal and reconciles readiness without a second approval', () => {
        const plan = makePlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        const generated = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(generated.status).toBe('generated');
        if (generated.status !== 'generated') return;
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, generated.proposalId, { action: 'accepted' });
        const applied = useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId);
        expect(applied.status).toBe('applied');
        if (applied.status !== 'applied') return;

        const verified = useProjectStore.getState().verifyDownstreamArtifactUpdateItem(projectId, plan.id, plan.items[0].id);
        expect(verified).toMatchObject({ status: 'verified', result: 'aligned' });
        const verification = useProjectStore.getState().downstreamArtifactUpdateVerifications[projectId][0];
        expect(verification.subject).toMatchObject({
            kind: 'application', planId: plan.id, itemId: plan.items[0].id,
            baselineArtifactVersionId: version.id, targetArtifactVersionId: applied.artifactVersionId,
        });
        expect(useProjectStore.getState().downstreamArtifactUpdateVerificationEvents[projectId] ?? []).toEqual([]);
        // The fixture intentionally lacks source provenance. Exact region
        // verification does not erase that independent artifact-level gap.
        expect(useProjectStore.getState().getArtifactAlignment(projectId, artifact.id)).toMatchObject({
            state: 'possibly_affected', confidence: 'unknown',
        });
        const summary = useProjectStore.getState().getDownstreamUpdatePlanSummary(projectId);
        expect(summary.blockingItems).toEqual([]);
        expect(summary.reviewedItems[0]).toMatchObject({ verificationOutcome: 'aligned' });
    });

    it('binds manual verification to the exact current artifact and invalidates it after another edit', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal);
        const manuallyUpdated: ArtifactVersion = {
            ...version, id: 'screens-manual', versionNumber: 2, parentVersionId: version.id,
            content: JSON.stringify({ sections: [{ title: 'Core', screens: [{
                id: 'workspace', name: 'Workspace', priority: 'P0', purpose: 'Local editing', states: [],
            }] }] }), isPreferred: true, createdAt: 200,
        };
        useProjectStore.setState({
            artifacts: { [projectId]: [{ ...artifact, currentVersionId: manuallyUpdated.id }] },
            artifactVersions: { [projectId]: [{ ...version, isPreferred: false }, manuallyUpdated] },
        });
        const verified = useProjectStore.getState().verifyDownstreamArtifactUpdateItem(projectId, plan.id, plan.items[0].id);
        expect(verified).toMatchObject({ status: 'verified', result: 'aligned' });
        const verification = useProjectStore.getState().downstreamArtifactUpdateVerifications[projectId][0];
        expect(verification.subject).toMatchObject({ kind: 'manual_update', targetArtifactVersionId: manuallyUpdated.id });
        expect(verification.subject?.applicationId).toBeUndefined();
        const { integrityHash: _verificationHash, ...verificationBase } = verification;
        void _verificationHash;
        const forged = sealDownstreamArtifactUpdateVerification({
            ...verificationBase,
            id: 'model-authored-false-alignment',
            result: 'aligned',
            reasoning: 'A generated narrative claims this is aligned.',
            remainingAmbiguity: undefined,
        });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateVerification(projectId, forged))
            .toEqual({ ok: false, reason: 'invalid_verification' });

        const concurrent = { ...manuallyUpdated, id: 'screens-concurrent', parentVersionId: manuallyUpdated.id, content: content('Cloud returned') };
        useProjectStore.setState({
            artifacts: { [projectId]: [{ ...artifact, currentVersionId: concurrent.id }] },
            artifactVersions: { [projectId]: [version, manuallyUpdated, concurrent] },
        });
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateVerificationEvent(projectId, verification.id, { action: 'confirmed' }))
            .toEqual({ ok: false, reason: 'stale' });
        expect(useProjectStore.getState().getArtifactAlignment(projectId, artifact.id)?.state).not.toBe('aligned');
    });

    it('records only a current exact proposal and user-authored review events', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal))
            .toEqual({ ok: true, duplicate: false });
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, { action: 'accepted' }))
            .toMatchObject({ ok: true, duplicate: false });
        expect(useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId][0].actor).toBe('user');
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, { ...proposal, authoredBy: 'user' } as never))
            .toEqual({ ok: false, reason: 'invalid_proposal' });
    });

    it('rejects edited-operation escalation beyond the proposal safety class', () => {
        const { plan, proposal: removal } = makeProposal();
        const { integrityHash: _proposalIntegrity, ...proposalBase } = removal;
        void _proposalIntegrity;
        const replacement = sealDownstreamArtifactUpdateProposal({
            ...proposalBase,
            id: 'replacement-proposal',
            operation: 'replace',
            proposedContent: '{"name":"Local"}',
        });
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, replacement);
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, replacement.id, {
            action: 'edited', operation: 'remove', editedContent: null, rationale: 'Delete the region instead.',
        })).toEqual({ ok: false, reason: 'operation_escalation' });
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, replacement.id, {
            action: 'edited', operation: 'structural', editedContent: 'broader rewrite', rationale: 'Rewrite the structure.',
        })).toEqual({ ok: false, reason: 'operation_escalation' });
        expect(useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId] ?? []).toEqual([]);
    });

    it('creates a fresh proposal identity only after the user requests another proposal', () => {
        const plan = makePlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        const first = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(first.status).toBe('generated');
        if (first.status !== 'generated') return;
        expect(useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id))
            .toMatchObject({ status: 'generated', proposalId: first.proposalId });
        expect(useProjectStore.getState().downstreamArtifactUpdateProposals[projectId]).toHaveLength(1);
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, first.proposalId, {
            action: 'requested_another', rationale: 'Try a more conservative bounded recommendation.',
        });
        const second = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(second.status).toBe('generated');
        if (second.status !== 'generated') return;
        expect(second.proposalId).not.toBe(first.proposalId);
        expect(useProjectStore.getState().downstreamArtifactUpdateProposals[projectId]).toHaveLength(2);
    });

    it('fails closed for changed planning authority, same-text spine identity, artifact edits, and stale review reuse', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal);
        useProjectStore.setState({ spineVersions: { [projectId]: [{ ...spine, id: 'spine-3' }] } });
        expect(useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, proposal.id)?.reasons)
            .toContain('spine_changed');
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, { action: 'accepted' }))
            .toEqual({ ok: false, reason: 'stale' });

        useProjectStore.setState({ spineVersions: { [projectId]: [spine] }, planningRecords: { [projectId]: [{ ...record, status: 'open' }] } });
        expect(useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, proposal.id)?.reasons)
            .toContain('planning_context_changed');
        useProjectStore.setState({ planningRecords: { [projectId]: [record] }, artifactVersions: { [projectId]: [{ ...version, content: content('Changed concurrently') }] } });
        expect(useProjectStore.getState().getDownstreamArtifactUpdateProposalCurrentness(projectId, proposal.id)?.reasons)
            .toEqual(expect.arrayContaining(['artifact_content_changed', 'region_content_changed']));
    });

    it('fails atomically when manual content changes after approval', () => {
        const plan = makePlan();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        const generated = useProjectStore.getState().generateDownstreamArtifactUpdateProposal(projectId, plan.id, plan.items[0].id);
        expect(generated.status).toBe('generated');
        if (generated.status !== 'generated') return;
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, generated.proposalId, { action: 'accepted' });
        useProjectStore.setState({
            artifactVersions: { [projectId]: [{ ...version, content: content('Manual edit after approval') }] },
        });

        expect(useProjectStore.getState().applyDownstreamArtifactUpdateProposal(projectId, generated.proposalId))
            .toEqual({ status: 'rejected', reason: 'stale' });
        expect(useProjectStore.getState().artifactVersions[projectId]).toHaveLength(1);
        expect(useProjectStore.getState().downstreamArtifactUpdateApplications[projectId] ?? []).toEqual([]);
        expect(useProjectStore.getState().historyEvents[projectId] ?? []).toEqual([]);
    });

    it('requires the latest exact user approval, consumes it once, and records application history without applying content', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal);
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, { action: 'accepted' });
        const review = useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId][0];
        const result: ArtifactVersion = {
            ...version, id: 'screens-v2', versionNumber: 2, parentVersionId: version.id,
            content: content('Saves locally'), isPreferred: true, createdAt: 200,
        };
        const resultRegion = resolveDownstreamUpdateRegionContent(result, proposal.region);
        useProjectStore.setState({
            artifacts: { [projectId]: [{ ...artifact, currentVersionId: result.id }] },
            artifactVersions: { [projectId]: [{ ...version, isPreferred: false }, result] },
        });
        const application = sealDownstreamArtifactUpdateApplication({
            schemaVersion: 1, id: 'application-1', projectId, proposalId: proposal.id,
            proposalIntegrityHash: proposal.integrityHash, authorizedByReviewEventId: review.id,
            authorizedByReviewEventIntegrityHash: review.integrityHash, actor: 'system', initiatedBy: 'user',
            effectiveOperation: 'remove', effectiveContentHash: null, expectedArtifactVersionId: version.id,
            expectedArtifactContentHash: proposal.artifact.artifactContentHash,
            expectedRegionContentHash: proposal.currentRegionContentHash, resultingArtifactVersionId: result.id,
            resultingArtifactContentHash: hashReviewValue(result.content), resultingRegionContentHash: resultRegion.contentHash!, appliedAt: 200,
        });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateApplication(projectId, application))
            .toEqual({ ok: true, duplicate: false });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateApplication(projectId, application))
            .toEqual({ ok: true, duplicate: true });
        const { integrityHash: _applicationIntegrity, ...applicationBase } = application;
        void _applicationIntegrity;
        const second = sealDownstreamArtifactUpdateApplication({ ...applicationBase, id: 'application-2', appliedAt: 201 });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateApplication(projectId, second))
            .toEqual({ ok: false, reason: 'authorization_consumed' });
        expect(useProjectStore.getState().artifactVersions[projectId]).toHaveLength(2);
    });

    it('keeps advisory verification and user confirmation separate, and stales both after another artifact edit', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal);
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, { action: 'accepted' });
        const review = useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId][0];
        const result: ArtifactVersion = {
            ...version, id: 'screens-v2', versionNumber: 2, parentVersionId: version.id,
            content: content('Saves locally'), isPreferred: true, createdAt: 200,
        };
        const resultRegion = resolveDownstreamUpdateRegionContent(result, proposal.region);
        useProjectStore.setState({
            artifacts: { [projectId]: [{ ...artifact, currentVersionId: result.id }] },
            artifactVersions: { [projectId]: [{ ...version, isPreferred: false }, result] },
        });
        const application = sealDownstreamArtifactUpdateApplication({
            schemaVersion: 1, id: 'application-1', projectId, proposalId: proposal.id,
            proposalIntegrityHash: proposal.integrityHash, authorizedByReviewEventId: review.id,
            authorizedByReviewEventIntegrityHash: review.integrityHash, actor: 'system', initiatedBy: 'user',
            effectiveOperation: 'remove', effectiveContentHash: null, expectedArtifactVersionId: version.id,
            expectedArtifactContentHash: proposal.artifact.artifactContentHash,
            expectedRegionContentHash: proposal.currentRegionContentHash, resultingArtifactVersionId: result.id,
            resultingArtifactContentHash: hashReviewValue(result.content), resultingRegionContentHash: resultRegion.contentHash!, appliedAt: 200,
        });
        useProjectStore.getState().recordDownstreamArtifactUpdateApplication(projectId, application);
        const verification = sealDownstreamArtifactUpdateVerification({
            schemaVersion: 1, id: 'verification-1', projectId, proposalId: proposal.id,
            proposalIntegrityHash: proposal.integrityHash, applicationId: application.id,
            applicationIntegrityHash: application.integrityHash, authoredBy: 'synapse', result: 'partial', evidence: [],
            reasoning: 'Cloud behavior changed, but the state remains.', remainingAmbiguity: 'Rename may be required.',
            verifiedArtifactVersionId: result.id, verifiedArtifactContentHash: hashReviewValue(result.content),
            verifiedRegionContentHash: resultRegion.contentHash!, generator: proposal.generator, createdAt: 210,
        });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateVerification(projectId, verification))
            .toEqual({ ok: true, duplicate: false });
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateVerificationEvent(projectId, verification.id, { action: 'confirmed' }))
            .toMatchObject({ ok: true });
        expect(useProjectStore.getState().downstreamArtifactUpdateVerificationEvents[projectId][0].actor).toBe('user');

        useProjectStore.setState({ artifacts: { [projectId]: [{ ...artifact, currentVersionId: 'screens-v3' }] } });
        expect(useProjectStore.getState().appendDownstreamArtifactUpdateVerificationEvent(projectId, verification.id, { action: 'confirmed' }))
            .toEqual({ ok: false, reason: 'stale' });
    });

    it('does not let a later defer reuse an earlier approval', () => {
        const { plan, proposal } = makeProposal();
        useProjectStore.getState().recordDownstreamUpdatePlan(projectId, plan);
        useProjectStore.getState().recordDownstreamArtifactUpdateProposal(projectId, proposal);
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, { action: 'accepted' });
        const accepted = useProjectStore.getState().downstreamArtifactUpdateReviewEvents[projectId][0];
        useProjectStore.getState().appendDownstreamArtifactUpdateReviewEvent(projectId, proposal.id, {
            action: 'deferred', rationale: 'Wait for the offline test.',
        });
        const fake = sealDownstreamArtifactUpdateApplication({
            schemaVersion: 1, id: 'application', projectId, proposalId: proposal.id, proposalIntegrityHash: proposal.integrityHash,
            authorizedByReviewEventId: accepted.id, authorizedByReviewEventIntegrityHash: accepted.integrityHash,
            actor: 'system', initiatedBy: 'user', effectiveOperation: 'remove', effectiveContentHash: null,
            expectedArtifactVersionId: version.id, expectedArtifactContentHash: proposal.artifact.artifactContentHash,
            expectedRegionContentHash: proposal.currentRegionContentHash, resultingArtifactVersionId: 'missing',
            resultingArtifactContentHash: 'missing', resultingRegionContentHash: 'missing', appliedAt: 200,
        });
        expect(useProjectStore.getState().recordDownstreamArtifactUpdateApplication(projectId, fake))
            .toEqual({ ok: false, reason: 'authorization_not_current' });
    });
});
