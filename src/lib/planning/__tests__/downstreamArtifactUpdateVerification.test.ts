import { describe, expect, it } from 'vitest';
import type { ArtifactVersion } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    sealDownstreamArtifactUpdateProposal,
} from '../downstreamArtifactUpdateProposal';
import {
    deriveDownstreamArtifactUpdateVerification,
    reconcileProjectOutputAlignment,
    type DownstreamVerificationProjection,
} from '../downstreamArtifactUpdateVerification';
import { downstreamPlanningContextHash, sealDownstreamUpdatePlan } from '../downstreamUpdatePlan';
import { resolveDownstreamUpdateRegionContent } from '../downstreamRegionContent';

const baseline: ArtifactVersion = {
    id: 'screens-v1', artifactId: 'screens', versionNumber: 1, parentVersionId: null,
    content: JSON.stringify({ sections: [{ title: 'Core', screens: [{
        id: 'workspace', name: 'Workspace', purpose: 'Cloud work', states: [],
    }] }] }), metadata: {}, sourceRefs: [], generationPrompt: '', isPreferred: false, createdAt: 1,
};
const current: ArtifactVersion = {
    ...baseline, id: 'screens-v2', parentVersionId: baseline.id, versionNumber: 2, isPreferred: true,
    content: JSON.stringify({ sections: [{ title: 'Core', screens: [{
        id: 'workspace', name: 'Workspace', purpose: 'Local work', states: [],
    }] }] }),
};
const records: never[] = [];
const plan = sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'plan', projectId: 'project', authoredBy: 'synapse', createdAt: 1,
    source: {
        kind: 'planning_change', summary: 'Local only', targetSpineVersionId: 'spine-v2',
        targetSpineContentHash: 'spine-hash', planningContextHash: downstreamPlanningContextHash(records), confirmed: true,
    },
    artifact: {
        artifactId: 'screens', artifactVersionId: baseline.id, artifactContentHash: hashReviewValue(baseline.content),
        slot: 'screen_inventory', title: 'Screens',
    },
    items: [{
        id: 'item', region: { kind: 'screen', screenId: 'workspace', screenName: 'Workspace', aspect: 'screen' },
        currentInterpretation: 'Cloud work', whyAffected: 'Local-only decision', certainty: 'definite',
        evidence: [{ id: 'e', kind: 'structured_trace', quality: 'direct', summary: 'Exact screen' }],
        recommendedAction: 'revise_behavior', recommendation: 'Use local behavior', preservedScope: [],
        recommendedPriority: 1, implementationCritical: true,
    }], preservedArtifactSummary: 'Other screens remain unchanged.',
});

describe('downstream artifact verification', () => {
    it('does not call a manual replacement aligned by hashing raw proposal text as parsed region content', () => {
        const region = resolveDownstreamUpdateRegionContent(baseline, plan.items[0].region);
        const proposal = sealDownstreamArtifactUpdateProposal({
            schemaVersion: 1, id: 'proposal', projectId: 'project', authoredBy: 'synapse',
            updatePlanBinding: {
                planId: plan.id, planIntegrityHash: plan.integrityHash, itemId: 'item',
                itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, plan.items[0]),
            },
            source: plan.source, artifact: plan.artifact, region: plan.items[0].region,
            regionKey: downstreamUpdateRegionKey(plan.items[0].region), currentRegionContentHash: region.contentHash!,
            currentRegionSnapshot: region.snapshot!, currentRegionSnapshotTruncated: false,
            operation: 'replace', proposedContent: region.snapshot!, evidence: plan.items[0].evidence,
            reasoning: 'Revise only this screen.', certainty: 'definite', preservedScope: [],
            preservedScopeHash: hashReviewValue([]), preservedRegionBindings: [],
            generator: { provider: 'synapse', model: 'bounded', promptHash: 'hash', reasoningVersion: 'v1' }, createdAt: 2,
        });
        const verification = deriveDownstreamArtifactUpdateVerification({
            projectId: 'project', plan, item: plan.items[0], proposal, baselineVersion: baseline, currentVersion: current,
            context: {
                spineVersionId: 'spine-v2', spineContentHash: 'spine-hash',
                planningContextHash: downstreamPlanningContextHash(records),
                artifactVersions: { screens: { versionId: current.id, contentHash: hashReviewValue(current.content) } },
            },
        });
        expect(verification.result).toBe('review_recommended');
        expect(verification.subject).toMatchObject({ kind: 'manual_update', targetArtifactVersionId: current.id });
    });

    it('clears only the addressed plan drift and preserves independent stale or upstream concerns', () => {
        const projection: DownstreamVerificationProjection = {
            planId: 'plan', itemId: 'item', artifactId: 'screens', artifactVersionId: 'screens-v2',
            outcome: 'aligned', deterministic: true, explanation: 'Exact region verified.', nextAction: 'Continue.',
            certainty: 'definite', implementationCritical: true,
        };
        const output = {
            artifactId: 'screens', nodeId: 'screen_inventory' as const, title: 'Screens', usefulForExploration: true as const,
            state: 'possibly_affected' as const, confidence: 'possible' as const, generatedFromSpineId: 'spine-v1',
            summary: 'The current plan changed.', reasons: ['The PRD changed in a relevant feature.'], nextAction: 'Review.', blocksBuildReadiness: true,
        };
        expect(reconcileProjectOutputAlignment({
            outputs: [output], alignedCount: 0, possiblyAffectedCount: 1, staleCount: 0, blockingCount: 1,
        }, [projection]).outputs[0]).toMatchObject({ state: 'aligned', blocksBuildReadiness: false });

        const stale = { ...output, state: 'stale' as const, confidence: 'definite' as const, reasons: ['Design tokens changed.'] };
        expect(reconcileProjectOutputAlignment({
            outputs: [stale], alignedCount: 0, possiblyAffectedCount: 0, staleCount: 1, blockingCount: 1,
        }, [projection]).outputs[0]).toMatchObject({ state: 'stale', blocksBuildReadiness: true });

        const upstream = { ...output, reasons: ['One or more upstream outputs also need alignment review.'] };
        expect(reconcileProjectOutputAlignment({
            outputs: [upstream], alignedCount: 0, possiblyAffectedCount: 1, staleCount: 0, blockingCount: 1,
        }, [projection]).outputs[0]).toMatchObject({ state: 'possibly_affected', blocksBuildReadiness: true });
    });
});
