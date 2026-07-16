import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import {
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateReviewEvent,
} from '../downstreamArtifactUpdateProposal';
import { sealDownstreamUpdatePlan, type DownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../downstreamUpdatePlan';
import {
    applyScreenFlowArtifactUpdate,
    deriveScreenFlowArtifactUpdateProposal,
    removedDownstreamUpdateRegionHash,
} from '../screenFlowArtifactUpdates';

const screenContent = JSON.stringify({ sections: [{ title: 'Core', screens: [
    {
        id: 'workspace', name: 'Workspace', priority: 'P0', purpose: 'Work locally', featureRefs: ['f1'],
        states: [
            { name: 'Syncing', type: 'loading', description: 'Uploads changes to the cloud.' },
            { name: 'Empty', type: 'empty', description: 'Start a local project.' },
        ],
        coreUIElements: ['Canvas', 'Local save status'],
        exitPaths: [{ label: 'Open settings', target: 'Settings' }],
    },
    { id: 'settings', name: 'Settings', priority: 'P1', purpose: 'Configure the app', states: [{ name: 'Default', description: 'Settings form' }] },
]}] });

const version = (artifactId: string, content: string): ArtifactVersion => ({
    id: `${artifactId}-v1`, artifactId, versionNumber: 1, parentVersionId: null, content,
    metadata: { manual: 'preserve' }, sourceRefs: [], generationPrompt: 'original', isPreferred: true, createdAt: 1,
});

function planFor(
    artifactVersion: ArtifactVersion,
    slot: 'screen_inventory' | 'user_flows',
    item: DownstreamUpdatePlanItem,
): DownstreamUpdatePlan {
    return sealDownstreamUpdatePlan({
        schemaVersion: 1, id: `plan-${slot}`, projectId: 'p1', authoredBy: 'synapse', createdAt: 10,
        source: {
            kind: 'planning_change', summary: 'Cloud synchronization was removed.', sourceSpineVersionId: 'spine-1',
            targetSpineVersionId: 'spine-2', targetSpineContentHash: 'spine-hash', planningContextHash: 'context-hash',
            planningRecordId: 'decision-1', planningEventId: 'event-1', confirmed: true,
        },
        artifact: {
            artifactId: artifactVersion.artifactId, artifactVersionId: artifactVersion.id,
            artifactContentHash: hashReviewValue(artifactVersion.content), slot, title: slot === 'screen_inventory' ? 'Screens' : 'Flows',
        },
        items: [item], preservedArtifactSummary: 'Everything outside the exact region remains unchanged.',
    });
}

const directEvidence = [{
    id: 'e1', kind: 'structured_trace' as const, quality: 'direct' as const,
    summary: 'This exact region explicitly traces to the removed feature.',
}];

describe('screen and flow selective update proposals', () => {
    it('removes one exact screen state and preserves sibling state, screen, and metadata values', () => {
        const artifactVersion = version('screens', screenContent);
        const item: DownstreamUpdatePlanItem = {
            id: 'sync-state',
            region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'state', aspectId: 'syncing', label: 'Syncing' },
            currentInterpretation: 'Syncing uploads changes.', whyAffected: 'Cloud sync was removed.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'remove_obsolete_element', recommendation: 'Remove only Syncing.',
            ambiguity: 'Offline save feedback remains necessary.', preservedScope: ['Empty state', 'Settings screen'],
            recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, 'screen_inventory', item);
        const derived = deriveScreenFlowArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('remove');
        expect(derived.proposal.preservedRegionBindings.length).toBeGreaterThan(0);
        const review = sealDownstreamArtifactUpdateReviewEvent({
            schemaVersion: 1, id: 'review', projectId: 'p1', proposalId: derived.proposal.id, actor: 'user', at: 30,
            expectedProposalIntegrityHash: derived.proposal.integrityHash,
            expectedPlanIntegrityHash: plan.integrityHash,
            expectedItemIntegrityHash: derived.proposal.updatePlanBinding.itemIntegrityHash,
            expectedRegionContentHash: derived.proposal.currentRegionContentHash,
            action: 'accepted',
        });
        const applied = applyScreenFlowArtifactUpdate({ proposal: derived.proposal, review, artifactVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        const before = JSON.parse(screenContent);
        const after = JSON.parse(applied.content);
        expect(after.sections[0].screens[0].states).toEqual([before.sections[0].screens[0].states[1]]);
        expect(after.sections[0].screens[0].coreUIElements).toEqual(before.sections[0].screens[0].coreUIElements);
        expect(after.sections[0].screens[0].exitPaths).toEqual(before.sections[0].screens[0].exitPaths);
        expect(after.sections[0].screens[1]).toEqual(before.sections[0].screens[1]);
        expect(resolveDownstreamUpdateRegionContent({ content: applied.content }, item.region)).toEqual({ found: false });
        expect(applied.resultingRegionContentHash).toBe(removedDownstreamUpdateRegionHash(item.region));
    });

    it('removes one exact decision line without rewriting the rest of either flow', () => {
        const flowContent = `# User Flows\n\n### Flow: Publish\n**Goal:** Publish locally.\n**Steps:**\n1. [Editor] — User saves → System stores locally\n   - **Decision:** If online → synchronize to cloud\n   - UI: Saved\n2. [Library] — User reviews → System lists projects\n**Success Outcome:** Project saved.\n\n### Flow: Settings\n**Goal:** Configure theme.\n**Steps:**\n1. [Settings] — User chooses theme → System saves preference\n**Success Outcome:** Theme changed.`;
        const artifactVersion = version('flows', flowContent);
        const item: DownstreamUpdatePlanItem = {
            id: 'sync-decision',
            region: { kind: 'flow', flowId: 'publish', flowName: 'Publish', aspect: 'decision', stepIndex: 0, label: 'If online → synchronize to cloud' },
            currentInterpretation: 'Online saves synchronize.', whyAffected: 'Cloud sync was removed.', certainty: 'definite',
            evidence: directEvidence, recommendedAction: 'reconsider_flow_branch', recommendation: 'Remove only the cloud branch.',
            preservedScope: ['Publish step 2', 'Flow: Settings'], recommendedPriority: 1, implementationCritical: true,
        };
        const plan = planFor(artifactVersion, 'user_flows', item);
        const derived = deriveScreenFlowArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('remove');
        const review = sealDownstreamArtifactUpdateReviewEvent({
            schemaVersion: 1, id: 'review-flow', projectId: 'p1', proposalId: derived.proposal.id, actor: 'user', at: 30,
            expectedProposalIntegrityHash: derived.proposal.integrityHash,
            expectedPlanIntegrityHash: plan.integrityHash,
            expectedItemIntegrityHash: derived.proposal.updatePlanBinding.itemIntegrityHash,
            expectedRegionContentHash: derived.proposal.currentRegionContentHash,
            action: 'accepted',
        });
        const applied = applyScreenFlowArtifactUpdate({ proposal: derived.proposal, review, artifactVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(applied.content).not.toContain('synchronize to cloud');
        expect(applied.content).toContain('   - UI: Saved');
        expect(applied.content).toContain('2. [Library] — User reviews → System lists projects');
        expect(applied.content.split('### Flow: Settings')[1]).toBe(flowContent.split('### Flow: Settings')[1]);
    });

    it('returns review-only guidance for possible impact and never turns weak relevance into content', () => {
        const artifactVersion = version('screens', screenContent);
        const item: DownstreamUpdatePlanItem = {
            id: 'possible',
            region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'screen' },
            currentInterpretation: 'The workspace may be relevant.', whyAffected: 'The persona changed.', certainty: 'possible',
            evidence: [{ id: 'weak', kind: 'plan_diff', quality: 'incomplete', summary: 'Language overlap only.' }],
            recommendedAction: 'revise_behavior', recommendation: 'Review.', preservedScope: ['Settings'],
            recommendedPriority: 1, implementationCritical: false,
        };
        const plan = planFor(artifactVersion, 'screen_inventory', item);
        const derived = deriveScreenFlowArtifactUpdateProposal({ projectId: 'p1', plan, item, artifactVersion, createdAt: 20 });
        expect(derived.ok && derived.proposal.operation).toBe('review_only');
        expect(derived.ok && derived.proposal.proposedContent).toBeNull();
    });
});
