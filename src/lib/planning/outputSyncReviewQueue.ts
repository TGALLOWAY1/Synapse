import type { ArtifactVersion } from '../../types';
import {
    compareDownstreamArtifactUpdateProposalCurrentness,
    latestDownstreamArtifactUpdateReview,
    validateDownstreamArtifactUpdateProposalIntegrity,
    type DownstreamArtifactUpdateOperation,
    type DownstreamArtifactUpdateProposal,
    type DownstreamArtifactUpdateReviewEvent,
} from './downstreamArtifactUpdateProposal';
import {
    validateDownstreamUpdatePlanIntegrity,
    type DownstreamImpactCertainty,
    type DownstreamUpdatePlan,
    type DownstreamUpdatePlanCurrentContext,
    type DownstreamUpdateRegion,
} from './downstreamUpdatePlan';

export type PrepareCurrentDownstreamProposalsResult =
    | {
        status: 'prepared';
        planIds: string[];
        attempted: number;
        created: number;
        prepared: Array<{
            planId: string;
            itemId: string;
            proposalId: string;
            operation: DownstreamArtifactUpdateOperation;
            reused: boolean;
        }>;
        rejected: Array<{ planId: string; itemId: string; reason: string }>;
    }
    | { status: 'rejected'; reason: string };

export interface OutputSyncReviewQueueItem {
    proposalId: string;
    planId: string;
    itemId: string;
    artifactId: string;
    artifactTitle: string;
    region: DownstreamUpdateRegion;
    regionLabel: string;
    operation: DownstreamArtifactUpdateOperation;
    certainty: DownstreamImpactCertainty;
    sourceSummary: string;
    reasoning: string;
    createdAt: number;
}

export interface ProjectOutputSyncReviewQueueInput {
    plans: DownstreamUpdatePlan[];
    proposals: DownstreamArtifactUpdateProposal[];
    reviewEvents: DownstreamArtifactUpdateReviewEvent[];
    artifactVersions: ArtifactVersion[];
    context?: DownstreamUpdatePlanCurrentContext;
}

export function outputSyncRegionLabel(region: DownstreamUpdateRegion): string {
    if (region.kind === 'screen') {
        return `${region.screenName} · ${region.label ?? region.aspect}`;
    }
    if (region.kind === 'flow') {
        return `${region.flowName} · ${region.label ?? (
            region.stepIndex === undefined ? region.aspect : `Step ${region.stepIndex + 1}`
        )}`;
    }
    if (region.kind === 'data_model') {
        return `${region.entityName} · ${region.label ?? region.memberName ?? region.aspect}`;
    }
    if (region.kind === 'implementation_plan') {
        return `${region.section === 'architecture' ? 'Architecture' : region.aspect.replace(/_/g, ' ')} · ${
            region.label ?? region.entryLabel
        }`;
    }
    return region.label;
}

/**
 * Project the exact-region proposals that are still safe to review.
 *
 * This is deliberately read-only: proposal generation carries no user
 * authority, and a reviewed proposal leaves this queue without being applied.
 * Existing proposal-currentness guards exclude stale spine, planning, artifact,
 * region, and preserved-region bindings.
 */
export function projectOutputSyncReviewQueue(
    input: ProjectOutputSyncReviewQueueInput,
): OutputSyncReviewQueueItem[] {
    if (!input.context) return [];

    const plansById = new Map(input.plans
        .filter(validateDownstreamUpdatePlanIntegrity)
        .map(plan => [plan.id, plan]));
    const artifactVersionsById = new Map(input.artifactVersions.map(version => [version.id, version]));
    const latestByItem = new Map<string, DownstreamArtifactUpdateProposal>();

    for (const proposal of input.proposals) {
        if (!validateDownstreamArtifactUpdateProposalIntegrity(proposal)) continue;
        const plan = plansById.get(proposal.updatePlanBinding.planId);
        const artifactVersion = artifactVersionsById.get(proposal.artifact.artifactVersionId);
        if (!compareDownstreamArtifactUpdateProposalCurrentness({
            proposal,
            plan,
            planContext: input.context,
            artifactVersion,
        }).current) continue;

        const key = `${proposal.updatePlanBinding.planId}:${proposal.updatePlanBinding.itemId}`;
        const prior = latestByItem.get(key);
        if (!prior
            || proposal.createdAt > prior.createdAt
            || (proposal.createdAt === prior.createdAt && proposal.id.localeCompare(prior.id) > 0)) {
            latestByItem.set(key, proposal);
        }
    }

    const certaintyOrder: Record<DownstreamImpactCertainty, number> = {
        definite: 0,
        likely: 1,
        possible: 2,
    };

    return [...latestByItem.values()]
        .filter(proposal => !latestDownstreamArtifactUpdateReview(proposal, input.reviewEvents))
        .map(proposal => ({
            proposalId: proposal.id,
            planId: proposal.updatePlanBinding.planId,
            itemId: proposal.updatePlanBinding.itemId,
            artifactId: proposal.artifact.artifactId,
            artifactTitle: proposal.artifact.title,
            region: proposal.region,
            regionLabel: outputSyncRegionLabel(proposal.region),
            operation: proposal.operation,
            certainty: proposal.certainty,
            sourceSummary: proposal.source.summary,
            reasoning: proposal.reasoning,
            createdAt: proposal.createdAt,
        }))
        .sort((left, right) => (
            certaintyOrder[left.certainty] - certaintyOrder[right.certainty]
            || left.artifactTitle.localeCompare(right.artifactTitle)
            || left.regionLabel.localeCompare(right.regionLabel)
            || left.proposalId.localeCompare(right.proposalId)
        ));
}
