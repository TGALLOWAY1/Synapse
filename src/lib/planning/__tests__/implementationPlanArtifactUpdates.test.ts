import { describe, expect, it } from 'vitest';
import type { ArtifactVersion, StructuredImplementationPlan } from '../../../types';
import { hashReviewValue } from '../../review/hash';
import { extractStructuredPlan } from '../../services/implementationPlanParser';
import { sealDownstreamArtifactUpdateReviewEvent } from '../downstreamArtifactUpdateProposal';
import { sealDownstreamUpdatePlan, type DownstreamUpdatePlan, type DownstreamUpdatePlanItem } from '../downstreamUpdatePlan';
import {
    applyImplementationPlanArtifactUpdate,
    deriveImplementationPlanArtifactUpdateProposal,
    parseUserGroundedImplementationPlanReplacement,
} from '../implementationPlanArtifactUpdates';

const structured: StructuredImplementationPlan = {
    overview: { summary: 'Deliver a focused product.' },
    milestones: [{
        id: 'm1', name: 'Foundation', tasks: [{ id: 't1', title: 'Build local editor', status: 'todo' }],
        definitionOfDone: ['Local editing works'],
    }],
    architecture: [
        '[feature:collaboration] Authentication and permission boundary for shared workspaces.',
        'Local persistence keeps editor drafts on device.',
    ],
};

const markdown = `# Implementation Plan

Manual introduction that must remain byte-for-byte unchanged.

\`\`\`json synapse-plan
${JSON.stringify(structured, null, 2)}
\`\`\`

Manual appendix that must also remain unchanged.`;

const artifactVersion: ArtifactVersion = {
    id: 'plan-v1', artifactId: 'plan', versionNumber: 1, parentVersionId: null,
    content: markdown, metadata: { manual: true }, sourceRefs: [], generationPrompt: '', isPreferred: true, createdAt: 1,
};

const item: DownstreamUpdatePlanItem = {
    id: 'architecture-auth',
    region: {
        kind: 'implementation_plan', section: 'architecture', aspect: 'authentication', entryIndex: 0,
        entryLabel: structured.architecture![0], label: structured.architecture![0],
    },
    currentInterpretation: structured.architecture![0], whyAffected: 'Collaboration was removed.', certainty: 'definite',
    evidence: [{ id: 'trace', kind: 'structured_trace', quality: 'direct', summary: 'Explicit feature trace.' }],
    recommendedAction: 'review_architecture', recommendation: 'Remove only the obsolete boundary.',
    preservedScope: ['Architecture entry 2', 'Milestone: Foundation'], recommendedPriority: 1, implementationCritical: true,
};

const plan: DownstreamUpdatePlan = sealDownstreamUpdatePlan({
    schemaVersion: 1, id: 'update-plan', projectId: 'p1', authoredBy: 'synapse', createdAt: 10,
    source: {
        kind: 'planning_change', summary: 'Collaboration was removed.', sourceSpineVersionId: 's1',
        targetSpineVersionId: 's2', targetSpineContentHash: 'spine', planningContextHash: 'context', confirmed: true,
    },
    artifact: {
        artifactId: 'plan', artifactVersionId: artifactVersion.id, artifactContentHash: hashReviewValue(markdown),
        slot: 'implementation_plan', title: 'Implementation Plan',
    },
    items: [item], preservedArtifactSummary: 'Only one architecture entry needs review.',
});

function reviewFor(proposal: ReturnType<typeof deriveImplementationPlanArtifactUpdateProposal> & { ok: true }) {
    return sealDownstreamArtifactUpdateReviewEvent({
        schemaVersion: 1, id: 'review', projectId: 'p1', proposalId: proposal.proposal.id, actor: 'user', at: 30,
        expectedProposalIntegrityHash: proposal.proposal.integrityHash,
        expectedPlanIntegrityHash: plan.integrityHash,
        expectedItemIntegrityHash: proposal.proposal.updatePlanBinding.itemIntegrityHash,
        expectedRegionContentHash: proposal.proposal.currentRegionContentHash,
        action: 'accepted',
    });
}

describe('selective structured architecture updates', () => {
    it('removes only an explicitly traced architecture entry and preserves markdown plus unrelated plan state', () => {
        const derived = deriveImplementationPlanArtifactUpdateProposal({
            projectId: 'p1', plan, item, artifactVersion, createdAt: 20,
        });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal.operation).toBe('remove');
        const applied = applyImplementationPlanArtifactUpdate({
            proposal: derived.proposal, review: reviewFor(derived), artifactVersion,
        });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(applied.content.split('```json synapse-plan')[0]).toBe(markdown.split('```json synapse-plan')[0]);
        expect(applied.content.split('```').at(-1)).toBe(markdown.split('```').at(-1));
        const after = extractStructuredPlan(applied.content)!;
        expect(after.architecture).toEqual([structured.architecture![1]]);
        expect(after.milestones).toEqual(structured.milestones);
        expect(after.overview).toEqual(structured.overview);
    });

    it('keeps ambiguous architecture relevance review-only', () => {
        const ambiguous = { ...item, certainty: 'possible' as const, evidence: [{
            id: 'reference', kind: 'deterministic_reference' as const, quality: 'inferred' as const, summary: 'Language overlap.',
        }] };
        const { integrityHash: _integrityHash, ...unsealedPlan } = plan;
        const ambiguousPlan = sealDownstreamUpdatePlan({ ...unsealedPlan, items: [ambiguous] });
        void _integrityHash;
        const derived = deriveImplementationPlanArtifactUpdateProposal({
            projectId: 'p1', plan: ambiguousPlan, item: ambiguous, artifactVersion, createdAt: 20,
        });
        expect(derived.ok && derived.proposal.operation).toBe('review_only');
    });

    it('accepts a replacement only from an explicit user-grounded instruction', () => {
        expect(parseUserGroundedImplementationPlanReplacement('Use passkeys instead')).toBeUndefined();
        const replacement = parseUserGroundedImplementationPlanReplacement('replace: Local identity with no shared-workspace roles.');
        const derived = deriveImplementationPlanArtifactUpdateProposal({
            projectId: 'p1', plan, item, artifactVersion, createdAt: 20, userGroundedReplacement: replacement,
        });
        expect(derived.ok).toBe(true);
        if (!derived.ok) return;
        expect(derived.proposal).toMatchObject({ operation: 'replace', proposedContent: replacement });
        const editedReview = sealDownstreamArtifactUpdateReviewEvent({
            schemaVersion: 1, id: 'replacement-review', projectId: 'p1', proposalId: derived.proposal.id, actor: 'user', at: 30,
            expectedProposalIntegrityHash: derived.proposal.integrityHash,
            expectedPlanIntegrityHash: plan.integrityHash,
            expectedItemIntegrityHash: derived.proposal.updatePlanBinding.itemIntegrityHash,
            expectedRegionContentHash: derived.proposal.currentRegionContentHash,
            action: 'accepted',
        });
        const applied = applyImplementationPlanArtifactUpdate({ proposal: derived.proposal, review: editedReview, artifactVersion });
        expect(applied.ok).toBe(true);
        if (!applied.ok) return;
        expect(extractStructuredPlan(applied.content)?.architecture?.[0]).toBe(replacement);
        expect(extractStructuredPlan(applied.content)?.milestones).toEqual(structured.milestones);
    });
});
