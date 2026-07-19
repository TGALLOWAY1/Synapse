import type { ArtifactVersion } from '../../types';
import { hashReviewValue } from '../review/hash';
import type { DownstreamArtifactUpdateApplication } from './downstreamArtifactUpdateProposal';
import {
    sealDownstreamUpdatePlan,
    sealDownstreamUpdatePlanEvent,
    validateDownstreamUpdatePlanEventIntegrity,
    type DownstreamUpdatePlan,
    type DownstreamUpdatePlanEvent,
    type DownstreamUpdatePlanItem,
} from './downstreamUpdatePlan';
import { resolveDownstreamUpdateRegionContent } from './downstreamRegionContent';

export type RebasedDownstreamUpdatePlan = {
    plan: DownstreamUpdatePlan;
    events: DownstreamUpdatePlanEvent[];
    predecessorItems: Map<string, DownstreamUpdatePlanItem>;
    regionStates: Map<string, 'unchanged' | 'changed' | 'missing'>;
};

const safeDisposition = (event: DownstreamUpdatePlanEvent | undefined): event is Extract<DownstreamUpdatePlanEvent, { type: 'disposition_recorded' }> => (
    event?.type === 'disposition_recorded'
    && ['deferred', 'not_applicable', 'already_aligned'].includes(event.disposition)
);

/**
 * Rebinds unapplied siblings to the exact child artifact version. This helper
 * never transfers a positive proposal approval. Missing regions stay visible
 * as conservative artifact-review work instead of being silently dropped.
 */
export function rebaseDownstreamUpdatePlanAfterApplication(input: {
    plan: DownstreamUpdatePlan;
    appliedItemId: string;
    application: DownstreamArtifactUpdateApplication;
    baselineVersion: ArtifactVersion;
    resultVersion: ArtifactVersion;
    events: DownstreamUpdatePlanEvent[];
    createdAt: number;
}): RebasedDownstreamUpdatePlan | undefined {
    const appliedItem = input.plan.items.find(item => item.id === input.appliedItemId);
    if (!appliedItem || input.resultVersion.artifactId !== input.plan.artifact.artifactId) return undefined;

    const predecessorItems = new Map<string, DownstreamUpdatePlanItem>();
    const regionStates = new Map<string, 'unchanged' | 'changed' | 'missing'>();
    const items = input.plan.items.filter(item => item.id !== input.appliedItemId).map((item, index) => {
        const resolved = resolveDownstreamUpdateRegionContent(input.resultVersion, item.region);
        const baseline = resolveDownstreamUpdateRegionContent(input.baselineVersion, item.region);
        const regionState = !resolved.found ? 'missing' as const
            : baseline.found && baseline.contentHash === resolved.contentHash ? 'unchanged' as const
                : 'changed' as const;
        const region = regionState === 'missing' ? {
            kind: 'artifact_review' as const,
            reason: 'insufficient_dependency' as const,
            label: item.region.kind === 'artifact_review' ? item.region.label : `Re-evaluate ${item.recommendation}`,
        } : item.region;
        const successorId = `update-item-${hashReviewValue({
            predecessorPlanId: input.plan.id,
            predecessorItemId: item.id,
            applicationId: input.application.id,
            artifactVersionId: input.resultVersion.id,
            region,
            currentRegionContentHash: resolved.contentHash,
        })}`;
        const successor: DownstreamUpdatePlanItem = {
            ...item,
            id: successorId,
            region,
            currentInterpretation: regionState === 'missing'
                ? 'The previously affected exact region no longer exists in this child artifact version. Its dependency must be reviewed without assuming that removal resolved it.'
                : regionState === 'changed'
                    ? (resolved.snapshot || 'The affected region changed while another selective update was applied.')
                    : item.currentInterpretation,
            evidence: [
                ...item.evidence,
                {
                    id: `rebase-${hashReviewValue({ item: item.id, version: input.resultVersion.id, hash: resolved.contentHash })}`,
                    kind: 'deterministic_reference',
                    quality: resolved.found ? 'direct' : 'incomplete',
                    summary: resolved.found
                        ? `Matched to the exact region in output Version ${input.resultVersion.versionNumber}.`
                        : `The predecessor region could not be resolved in artifact version ${input.resultVersion.versionNumber}.`,
                    sourceId: input.resultVersion.id,
                    ...(resolved.contentHash ? { contentHash: resolved.contentHash } : {}),
                },
            ],
            ambiguity: regionState === 'missing'
                ? 'Review the current output structure before choosing a focused update.'
                : regionState === 'changed'
                    ? 'A sibling application changed this region; review the fresh proposal before authorizing any update.'
                    : item.ambiguity,
            recommendedAction: regionState === 'missing' ? 'review_only' : item.recommendedAction,
            recommendation: regionState === 'missing'
                ? 'Review the current artifact to identify whether a replacement dependency remains.'
                : item.recommendation,
            recommendedPriority: index + 1,
        };
        predecessorItems.set(successorId, item);
        regionStates.set(successorId, regionState);
        return successor;
    });

    const planSeed = {
        predecessorPlanId: input.plan.id,
        predecessorPlanIntegrityHash: input.plan.integrityHash,
        applicationId: input.application.id,
        applicationIntegrityHash: input.application.integrityHash,
        artifactVersionId: input.resultVersion.id,
        artifactContentHash: hashReviewValue(input.resultVersion.content),
        items: items.map(item => item.id),
    };
    const { integrityHash: _predecessorIntegrityHash, ...predecessorPlan } = input.plan;
    void _predecessorIntegrityHash;
    const plan = sealDownstreamUpdatePlan({
        ...predecessorPlan,
        id: `update-plan-${hashReviewValue(planSeed)}`,
        artifact: {
            ...input.plan.artifact,
            artifactVersionId: input.resultVersion.id,
            artifactContentHash: hashReviewValue(input.resultVersion.content),
        },
        items,
        rebase: {
            predecessorPlanId: input.plan.id,
            predecessorPlanIntegrityHash: input.plan.integrityHash,
            triggeringApplicationId: input.application.id,
            triggeringApplicationIntegrityHash: input.application.integrityHash,
            appliedPredecessorItemId: input.appliedItemId,
            itemLineage: items.map(item => ({
                predecessorItemId: predecessorItems.get(item.id)!.id,
                successorItemId: item.id,
                regionState: regionStates.get(item.id)!,
            })),
        },
        preservedArtifactSummary: items.length === 0
            ? 'All focused items from this update plan were applied or reconciled. Unlisted output work remains preserved.'
            : `The applied region is preserved in history. ${items.length} remaining region${items.length === 1 ? '' : 's'} now refer to the new output version.`,
        createdAt: input.createdAt,
    });

    let at = input.createdAt;
    const events: DownstreamUpdatePlanEvent[] = [];
    for (const item of items) {
        if (regionStates.get(item.id) !== 'unchanged') continue;
        const predecessor = predecessorItems.get(item.id)!;
        const exact = input.events
            .filter(event => event.planId === input.plan.id
                && event.itemId === predecessor.id
                && event.expectedPlanIntegrityHash === input.plan.integrityHash
                && validateDownstreamUpdatePlanEventIntegrity(event))
            .sort((a, b) => b.at - a.at || b.id.localeCompare(a.id));
        const disposition = exact.find(event => event.type === 'disposition_recorded');
        if (safeDisposition(disposition)) {
            events.push(sealDownstreamUpdatePlanEvent({
                schemaVersion: 1,
                id: `update-plan-event-${hashReviewValue({ plan: plan.id, item: item.id, source: disposition.integrityHash })}`,
                projectId: plan.projectId,
                planId: plan.id,
                itemId: item.id,
                actor: 'user',
                at: ++at,
                expectedPlanIntegrityHash: plan.integrityHash,
                carriedFrom: {
                    eventId: disposition.id,
                    eventIntegrityHash: disposition.integrityHash,
                    planId: input.plan.id,
                    itemId: predecessor.id,
                },
                type: 'disposition_recorded',
                disposition: disposition.disposition,
                ...(disposition.rationale ? { rationale: disposition.rationale } : {}),
            }));
        }
        const priority = exact.find(event => event.type === 'priority_changed');
        if (priority?.type === 'priority_changed') {
            events.push(sealDownstreamUpdatePlanEvent({
                schemaVersion: 1,
                id: `update-plan-event-${hashReviewValue({ plan: plan.id, item: item.id, source: priority.integrityHash })}`,
                projectId: plan.projectId,
                planId: plan.id,
                itemId: item.id,
                actor: 'user',
                at: ++at,
                expectedPlanIntegrityHash: plan.integrityHash,
                carriedFrom: {
                    eventId: priority.id,
                    eventIntegrityHash: priority.integrityHash,
                    planId: input.plan.id,
                    itemId: predecessor.id,
                },
                type: 'priority_changed',
                priority: priority.priority,
            }));
        }
    }
    return { plan, events, predecessorItems, regionStates };
}
