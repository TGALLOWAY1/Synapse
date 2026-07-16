import type { ArtifactVersion, StructuredImplementationPlan } from '../../types';
import { extractStructuredPlan } from '../services/implementationPlanParser';
import { hashReviewValue } from '../review/hash';
import {
    downstreamUpdatePlanItemIntegrityHash,
    downstreamUpdateRegionKey,
    resolveDownstreamUpdateRegionContent,
    sealDownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateOperation,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
} from './downstreamArtifactUpdateProposal';
import { removedDownstreamUpdateRegionHash } from './screenFlowArtifactUpdates';
import type { DownstreamUpdatePlan, DownstreamUpdatePlanItem, DownstreamUpdateRegion } from './downstreamUpdatePlan';

type ArchitectureRegion = Extract<DownstreamUpdateRegion, { kind: 'implementation_plan'; section: 'architecture' }>;

type ProposalInput = {
    projectId: string;
    plan: DownstreamUpdatePlan;
    item: DownstreamUpdatePlanItem;
    artifactVersion: ArtifactVersion;
    createdAt?: number;
    requestNonce?: string;
    userGroundedReplacement?: string;
};

export type ImplementationPlanProposalResult =
    | { ok: true; proposal: DownstreamArtifactUpdateProposal }
    | { ok: false; reason: 'unsupported_artifact' | 'region_missing' | 'binding_mismatch' };

const STRUCTURED_PLAN_FENCE = /(```json\s+synapse-plan\s*\n)([\s\S]*?)(\n```)/;

export function parseUserGroundedImplementationPlanReplacement(context: string): string | undefined {
    const match = context.trim().match(/^replace\s*:\s*([\s\S]+)$/i);
    return match?.[1]?.trim() || undefined;
}

function exactArchitectureRemoval(plan: DownstreamUpdatePlan, item: DownstreamUpdatePlanItem): boolean {
    return plan.source.confirmed
        && item.region.kind === 'implementation_plan'
        && item.region.section === 'architecture'
        && item.certainty === 'definite'
        && item.evidence.some(evidence => evidence.kind === 'structured_trace' && evidence.quality === 'direct')
        && item.recommendedAction === 'review_architecture';
}

function preservedBindings(
    version: ArtifactVersion,
    target: ArchitectureRegion,
): DownstreamArtifactUpdateProposal['preservedRegionBindings'] {
    const plan = extractStructuredPlan(version.content);
    return (plan?.architecture ?? []).flatMap((entry, entryIndex) => {
        if (entryIndex === target.entryIndex) return [];
        const region: ArchitectureRegion = {
            kind: 'implementation_plan', section: 'architecture', aspect: 'decision',
            entryIndex, entryLabel: entry, label: entry,
        };
        const content = resolveDownstreamUpdateRegionContent(version, region);
        return content.found && content.contentHash ? [{
            region, regionKey: downstreamUpdateRegionKey(region), contentHash: content.contentHash,
        }] : [];
    });
}

export function deriveImplementationPlanArtifactUpdateProposal(input: ProposalInput): ImplementationPlanProposalResult {
    const { plan, item, artifactVersion } = input;
    if (plan.projectId !== input.projectId || plan.artifact.artifactVersionId !== artifactVersion.id
        || !plan.items.some(candidate => candidate.id === item.id)) return { ok: false, reason: 'binding_mismatch' };
    if (plan.artifact.slot !== 'implementation_plan' || item.region.kind !== 'implementation_plan'
        || item.region.section !== 'architecture') return { ok: false, reason: 'unsupported_artifact' };
    const region = resolveDownstreamUpdateRegionContent(artifactVersion, item.region);
    if (!region.found || !region.contentHash || region.snapshot === undefined) return { ok: false, reason: 'region_missing' };

    const remove = exactArchitectureRemoval(plan, item);
    const replacement = input.userGroundedReplacement?.trim();
    const operation: DownstreamArtifactUpdateOperation = replacement ? 'replace' : remove ? 'remove' : 'review_only';
    const proposedContent = replacement || null;
    const resultingRegion: ArchitectureRegion | undefined = replacement ? {
        ...item.region, entryLabel: replacement, label: replacement,
    } : undefined;
    const createdAt = input.createdAt ?? Date.now();
    const requestNonce = input.requestNonce ?? 'initial';
    return { ok: true, proposal: sealDownstreamArtifactUpdateProposal({
        schemaVersion: 1,
        id: `artifact-update-${hashReviewValue({ plan: plan.id, item: item.id, region: region.contentHash, requestNonce, createdAt })}`,
        projectId: input.projectId,
        authoredBy: 'synapse',
        updatePlanBinding: {
            planId: plan.id,
            planIntegrityHash: plan.integrityHash,
            itemId: item.id,
            itemIntegrityHash: downstreamUpdatePlanItemIntegrityHash(plan, item),
        },
        source: plan.source,
        artifact: plan.artifact,
        region: item.region,
        regionKey: downstreamUpdateRegionKey(item.region),
        ...(resultingRegion ? { resultingRegion } : {}),
        currentRegionContentHash: region.contentHash,
        currentRegionSnapshot: region.snapshot,
        currentRegionSnapshotTruncated: Boolean(region.snapshotTruncated),
        operation,
        proposedContent,
        evidence: item.evidence,
        reasoning: replacement
            ? 'The replacement is bounded to this exact architecture entry and comes from context explicitly supplied by the user.'
            : remove
                ? 'The confirmed removal and explicit feature trace support deleting only this exact architecture entry.'
                : 'The architecture reference is relevant, but it does not prove a safe exact edit. Review this entry or provide an explicit `replace:` instruction.',
        certainty: item.certainty,
        ...(item.ambiguity ? { ambiguity: item.ambiguity } : {}),
        preservedScope: item.preservedScope,
        preservedScopeHash: hashReviewValue(item.preservedScope),
        preservedRegionBindings: preservedBindings(artifactVersion, item.region),
        generator: {
            provider: 'synapse', model: 'bounded-structural-planner',
            promptHash: hashReviewValue({ plan: plan.integrityHash, item, requestNonce, replacement }),
            reasoningVersion: 'phase-5-architecture-v1',
        },
        createdAt,
    }) };
}

function replaceStructuredPlanFence(content: string, plan: StructuredImplementationPlan): string | undefined {
    const match = STRUCTURED_PLAN_FENCE.exec(content);
    if (!match || match.index === undefined) return undefined;
    const replacement = `${match[1]}${JSON.stringify(plan, null, 2)}${match[3]}`;
    return content.slice(0, match.index) + replacement + content.slice(match.index + match[0].length);
}

export function applyImplementationPlanArtifactUpdate(input: {
    proposal: DownstreamArtifactUpdateProposal;
    review: DownstreamArtifactUpdateReviewEvent;
    artifactVersion: ArtifactVersion;
}):
    | { ok: true; content: string; resultingRegionContentHash: string }
    | { ok: false; reason: 'unsupported_region' | 'invalid_content' | 'target_missing' | 'no_change' } {
    const { proposal, review, artifactVersion } = input;
    if (proposal.artifact.slot !== 'implementation_plan' || proposal.region.kind !== 'implementation_plan'
        || proposal.region.section !== 'architecture') return { ok: false, reason: 'unsupported_region' };
    const operation = review.action === 'edited' ? review.operation
        : review.action === 'accepted' && proposal.operation !== 'review_only' ? proposal.operation
            : undefined;
    const proposedContent = review.action === 'edited' ? review.editedContent : proposal.proposedContent;
    if (!operation || !['remove', 'replace'].includes(operation)) return { ok: false, reason: 'unsupported_region' };
    const plan = extractStructuredPlan(artifactVersion.content);
    if (!plan?.architecture || plan.architecture[proposal.region.entryIndex] !== proposal.region.entryLabel) {
        return { ok: false, reason: 'target_missing' };
    }
    const nextPlan: StructuredImplementationPlan = { ...plan, architecture: [...plan.architecture] };
    if (operation === 'remove') nextPlan.architecture!.splice(proposal.region.entryIndex, 1);
    else {
        if (!proposedContent?.trim()) return { ok: false, reason: 'invalid_content' };
        nextPlan.architecture![proposal.region.entryIndex] = proposedContent.trim();
    }
    const next = replaceStructuredPlanFence(artifactVersion.content, nextPlan);
    if (!next) return { ok: false, reason: 'invalid_content' };
    if (next === artifactVersion.content) return { ok: false, reason: 'no_change' };
    const resultingRegion = proposal.resultingRegion ?? proposal.region;
    const result = resolveDownstreamUpdateRegionContent({ content: next }, resultingRegion);
    if (operation === 'remove') {
        if (result.found) return { ok: false, reason: 'invalid_content' };
        return { ok: true, content: next, resultingRegionContentHash: removedDownstreamUpdateRegionHash(proposal.region) };
    }
    if (!result.found || !result.contentHash) return { ok: false, reason: 'invalid_content' };
    return { ok: true, content: next, resultingRegionContentHash: result.contentHash };
}
