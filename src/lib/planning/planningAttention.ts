import type { PlanningRecord, ReviewIssue } from '../../types';
import {
    assumptionStatementHash,
    assumptionValidationEventIntegrityHash,
    projectAssumptionValidation,
} from './assumptionValidation';
import { projectDecision } from './decisionProjection';
import type { DownstreamUpdatePlanSummaryItem } from './downstreamUpdatePlan';
import type { OutputAlignment } from './outputAlignment';
import type { PlanningDestination } from './planningNavigation';
import {
    derivePlanningReadiness,
    planningRecordNeedsAlignment,
    planningRecordRequiresResolution,
    reviewIssueNeedsResolutionBeforeBuild,
    type PlanningReadiness,
    type PlanningReadinessInput,
} from './planningReadiness';

export type PlanningAttentionCondition =
    | 'clarify_foundation'
    | 'needs_decision'
    | 'worth_validating'
    | 'accepted_risk_due'
    | 'review_changed_context'
    | 'needs_alignment'
    | 'confirm_scope'
    | 'challenge_finding'
    | 'challenge_plan'
    | 'update_required'
    | 'review_recommended'
    | 'legacy_review'
    | 'ready_to_commit';

export type PlanningAttentionSourceRef = {
    kind: 'planning_record' | 'challenge' | 'update_plan' | 'output' | 'legacy_artifact' | 'readiness';
    id: string;
    versionId?: string;
};

export type PlanningAttentionItem = {
    /** Durable identity only. Human-readable text never participates in dedupe. */
    key: string;
    condition: PlanningAttentionCondition;
    title: string;
    why: string;
    actionLabel: string;
    destination: PlanningDestination;
    materiality: 'blocking' | 'high' | 'normal' | 'low';
    dependencyCount: number;
    actionableNow: boolean;
    sourceRefs: PlanningAttentionSourceRef[];
};

export type PlanningAttentionSummary = {
    primary?: PlanningAttentionItem;
    secondary: PlanningAttentionItem[];
    totalCount: number;
    hiddenCount: number;
    readiness: PlanningReadiness;
};

export type PlanningAttentionInput = PlanningReadinessInput & {
    reviewIssues?: ReviewIssue[];
    outputAlignments?: OutputAlignment[];
};

type RankedAttentionItem = PlanningAttentionItem & { rank: number };

const materialityRank = { blocking: 0, high: 1, normal: 2, low: 3 } as const;

const recordMateriality = (record: PlanningRecord): PlanningAttentionItem['materiality'] =>
    record.materiality ?? 'high';

const recordDependencyCount = (record: PlanningRecord): number => new Set([
    ...(record.affectedFeatureIds ?? []).map(id => `feature:${id}`),
    ...(record.affectedArtifactSlots ?? []).map(id => `artifact:${id}`),
    ...(record.affectedPlanLocations ?? []).map(location => (
        `plan:${location.kind}:${location.jsonPath ?? location.entityId ?? location.label}`
    )),
    ...(record.relatedPlanningRecordIds ?? []).map(id => `record:${id}`),
]).size;

const acceptedRiskState = (record: PlanningRecord, input: PlanningAttentionInput): {
    accepted: boolean;
    revisitDue: boolean;
    contextChanged: boolean;
} => {
    if (record.type !== 'assumption') return { accepted: false, revisitDue: false, contextChanged: false };
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    const validation = projectAssumptionValidation(record, evaluatedAt);
    if (!validation.userTreatment) return { accepted: false, revisitDue: false, contextChanged: false };
    const treatmentEvent = [...(record.assumptionValidation?.events ?? [])].reverse().find(event => (
        event.type === 'validation_uncertainty_treatment_recorded'
        && event.actor === 'user'
        && event.planningRecordId === record.id
        && event.treatment === validation.userTreatment
        && event.rationale === validation.treatmentRationale
        && event.integrityHash === assumptionValidationEventIntegrityHash(event)
    ));
    const contextChanged = record.sourceState === 'changed'
        || record.sourceState === 'missing'
        || Boolean(treatmentEvent && treatmentEvent.assumptionStatementHash !== assumptionStatementHash(record))
        || Boolean(treatmentEvent?.expectedSpineVersionId && input.currentSpineVersionId
            && treatmentEvent.expectedSpineVersionId !== input.currentSpineVersionId)
        || Boolean(treatmentEvent?.expectedSpineContentHash && input.currentSpineContentHash
            && treatmentEvent.expectedSpineContentHash !== input.currentSpineContentHash);
    const revisitDue = validation.revisitAt !== undefined && validation.revisitAt <= evaluatedAt;
    return { accepted: true, revisitDue, contextChanged };
};

const recordItem = (
    record: PlanningRecord,
    allRecords: PlanningRecord[],
    input: PlanningAttentionInput,
): RankedAttentionItem | undefined => {
    const evaluatedAt = input.evaluatedAt ?? Date.now();
    const changedContext = record.sourceState === 'changed' || record.sourceState === 'missing';
    const acceptedRisk = acceptedRiskState(record, input);
    const needsAlignment = planningRecordNeedsAlignment(record);
    const needsResolution = planningRecordRequiresResolution(
        record,
        allRecords,
        new Set(),
        evaluatedAt,
        {
            currentSpineVersionId: input.currentSpineVersionId,
            currentSpineContentHash: input.currentSpineContentHash,
        },
    );
    if (!changedContext && !needsAlignment && !needsResolution) return undefined;
    if (!changedContext && !needsAlignment && acceptedRisk.accepted
        && !acceptedRisk.revisitDue && !acceptedRisk.contextChanged) return undefined;

    const state = projectDecision(record);
    const acceptedRiskDue = acceptedRisk.accepted && (acceptedRisk.revisitDue || acceptedRisk.contextChanged);

    let condition: PlanningAttentionCondition;
    let actionLabel: string;
    let rank: number;
    if (changedContext) {
        condition = 'review_changed_context';
        actionLabel = 'Review changed context';
        rank = 10;
    } else if (needsAlignment) {
        condition = 'needs_alignment';
        actionLabel = 'Review plan alignment';
        rank = 40;
    } else if (acceptedRiskDue) {
        condition = 'accepted_risk_due';
        actionLabel = 'Review accepted risk';
        rank = 30;
    } else if (record.type === 'assumption') {
        condition = 'worth_validating';
        actionLabel = 'Validate this assumption';
        rank = 30;
    } else {
        condition = 'needs_decision';
        actionLabel = record.type === 'conflict'
            ? 'Resolve this conflict'
            : record.type === 'risk'
                ? 'Review this risk'
                : state.status === 'invalidated'
                    ? 'Make a new decision'
                    : 'Make this decision';
        rank = record.type === 'conflict' ? 20 : record.type === 'risk' ? 22 : 21;
    }

    return {
        key: `record:${record.id}`,
        condition,
        title: record.title,
        why: record.whyItMatters?.trim() || record.statement,
        actionLabel,
        destination: { kind: 'planning_record', recordId: record.id },
        materiality: recordMateriality(record),
        dependencyCount: recordDependencyCount(record),
        actionableNow: true,
        sourceRefs: [{ kind: 'planning_record', id: record.id }],
        rank,
    };
};

const challengeMateriality = (issue: ReviewIssue): PlanningAttentionItem['materiality'] => {
    if (issue.implementationImpact === 'blocker' || issue.severity === 'critical') return 'blocking';
    if (issue.implementationImpact === 'resolve_before_build' || issue.severity === 'high') return 'high';
    if (issue.severity === 'low') return 'low';
    return 'normal';
};

const regionIdentity = (item: DownstreamUpdatePlanSummaryItem): string => {
    const region = item.region;
    switch (region.kind) {
        case 'screen': return `screen:${region.screenId}:${region.aspect}:${region.aspectId ?? ''}`;
        case 'flow': return `flow:${region.flowId}:${region.aspect}:${region.stepIndex ?? ''}`;
        case 'data_model': return `data:${region.entityName}:${region.aspect}:${region.memberName ?? ''}`;
        case 'implementation_plan': return `implementation:${region.section}:${region.aspect}:${region.entryIndex}`;
        case 'artifact_review': return `artifact-review:${region.reason}`;
    }
};

const regionLabel = (item: DownstreamUpdatePlanSummaryItem): string => {
    const region = item.region;
    switch (region.kind) {
        case 'screen': return region.label || `${region.screenName} · ${region.aspect}`;
        case 'flow': return region.label || `${region.flowName} · ${region.aspect}`;
        case 'data_model': return region.label || `${region.entityName}${region.memberName ? ` · ${region.memberName}` : ''}`;
        case 'implementation_plan': return region.label || region.entryLabel;
        case 'artifact_review': return region.label;
    }
};

const updatePlanItem = (
    item: DownstreamUpdatePlanSummaryItem,
    definite: boolean,
): RankedAttentionItem => ({
    key: `output:${item.artifactId}:region:${regionIdentity(item)}:source:${item.planId}`,
    condition: definite ? 'update_required' : 'review_recommended',
    title: `${item.artifactTitle}: ${regionLabel(item)}`,
    why: item.recommendation,
    actionLabel: definite ? 'Plan this update' : 'Review possible impact',
    destination: {
        kind: 'update_plan',
        planId: item.planId,
        itemId: item.itemId,
        artifactId: item.artifactId,
        nodeId: item.nodeId,
    },
    materiality: definite ? item.implementationCritical ? 'blocking' : 'high' : 'normal',
    dependencyCount: 1,
    actionableNow: true,
    sourceRefs: [{ kind: 'update_plan', id: item.planId, versionId: item.artifactVersionId }],
    rank: definite ? 80 : 90,
});

const mergeItem = (existing: RankedAttentionItem, incoming: RankedAttentionItem): RankedAttentionItem => {
    const sourceRefs = [...existing.sourceRefs];
    for (const ref of incoming.sourceRefs) {
        if (!sourceRefs.some(candidate => (
            candidate.kind === ref.kind && candidate.id === ref.id && candidate.versionId === ref.versionId
        ))) sourceRefs.push(ref);
    }
    const incomingMoreMaterial = materialityRank[incoming.materiality] < materialityRank[existing.materiality];
    return {
        ...(incoming.rank < existing.rank ? incoming : existing),
        materiality: incomingMoreMaterial ? incoming.materiality : existing.materiality,
        dependencyCount: Math.max(existing.dependencyCount, incoming.dependencyCount),
        actionableNow: existing.actionableNow || incoming.actionableNow,
        sourceRefs,
        rank: Math.min(existing.rank, incoming.rank),
    };
};

const sorted = (items: Iterable<RankedAttentionItem>): RankedAttentionItem[] => [...items].sort((a, b) =>
    a.rank - b.rank
    || materialityRank[a.materiality] - materialityRank[b.materiality]
    || a.key.localeCompare(b.key),
);

function primaryKeyFor(readiness: PlanningReadiness, items: RankedAttentionItem[]): string | undefined {
    const action = readiness.nextAction;
    if (action.planningRecordId) {
        const key = `record:${action.planningRecordId}`;
        if (items.some(item => item.key === key)) return key;
    }
    if (action.artifactId) {
        const match = items.find(item => item.destination.kind === 'update_plan'
            && item.destination.artifactId === action.artifactId);
        if (match) return match.key;
    }
    if (action.kind === 'clarify_foundation') return items.find(item => item.condition === 'clarify_foundation')?.key;
    if (action.kind === 'confirm_scope') return items.find(item => item.condition === 'confirm_scope')?.key;
    if (action.kind === 'challenge_plan') return items.find(item => item.condition === 'challenge_finding')?.key
        ?? items.find(item => item.condition === 'challenge_plan')?.key;
    if (action.kind === 'commit_plan') return items.find(item => item.condition === 'ready_to_commit')?.key;
    if (action.kind === 'align_outputs') return items.find(item => (
        item.condition === 'update_required' || item.condition === 'review_recommended' || item.condition === 'legacy_review'
    ))?.key;
    return undefined;
}

/**
 * Pure, non-persisted projection of the few planning conditions most worth the
 * user's attention. It reuses the live readiness boundary and existing durable
 * identities; it never creates authority, modifies readiness, or deduplicates
 * by generated text.
 */
export function derivePlanningAttention(input: PlanningAttentionInput): PlanningAttentionSummary {
    const readiness = derivePlanningReadiness(input);
    const byKey = new Map<string, RankedAttentionItem>();
    const upsert = (item: RankedAttentionItem) => {
        const existing = byKey.get(item.key);
        byKey.set(item.key, existing ? mergeItem(existing, item) : item);
    };

    if (readiness.nextAction.kind === 'clarify_foundation') {
        upsert({
            key: 'foundation:current-plan', condition: 'clarify_foundation',
            title: 'Strengthen the product foundation', why: readiness.nextAction.detail,
            actionLabel: readiness.nextAction.label, destination: { kind: 'prd' },
            materiality: 'high', dependencyCount: readiness.criteria.filter(item => item.status !== 'met').length,
            actionableNow: true, sourceRefs: [{ kind: 'readiness', id: 'live:foundation' }], rank: 0,
        });
    }

    for (const record of input.planningRecords) {
        const item = recordItem(record, input.planningRecords, input);
        if (item) upsert(item);
    }

    for (const issue of input.reviewIssues ?? []) {
        if (!reviewIssueNeedsResolutionBeforeBuild(issue, input.currentSpineVersionId)) continue;
        const linkedRecordId = [...issue.relatedPlanningRecordIds].sort()[0];
        const key = linkedRecordId ? `record:${linkedRecordId}` : `challenge:${issue.id}`;
        upsert({
            key, condition: 'challenge_finding', title: issue.title, why: issue.summary,
            actionLabel: 'Address challenge finding',
            destination: linkedRecordId
                ? { kind: 'planning_record', recordId: linkedRecordId }
                : { kind: 'challenge', reviewId: issue.reviewId, issueId: issue.id },
            materiality: challengeMateriality(issue),
            dependencyCount: new Set(issue.findingIds).size,
            actionableNow: true,
            sourceRefs: [{ kind: 'challenge', id: issue.id, versionId: issue.reviewId }],
            rank: 60,
        });
    }

    if (readiness.nextAction.kind === 'confirm_scope') {
        upsert({
            key: 'scope:first-release', condition: 'confirm_scope', title: 'Confirm first-release scope',
            why: readiness.nextAction.detail, actionLabel: readiness.nextAction.label,
            destination: { kind: 'prd', anchorId: 'features' }, materiality: 'high',
            dependencyCount: input.prd?.features?.length ?? 0, actionableNow: true,
            sourceRefs: [{ kind: 'readiness', id: 'live:scope' }], rank: 50,
        });
    }

    if (readiness.nextAction.kind === 'challenge_plan'
        && !(input.reviewIssues ?? []).some(issue => reviewIssueNeedsResolutionBeforeBuild(issue, input.currentSpineVersionId))) {
        upsert({
            key: 'challenge:current-plan', condition: 'challenge_plan', title: 'Challenge the current plan',
            why: readiness.nextAction.detail, actionLabel: readiness.nextAction.label,
            destination: { kind: 'challenge' }, materiality: 'normal', dependencyCount: 0,
            actionableNow: true, sourceRefs: [{ kind: 'readiness', id: 'live:challenge' }], rank: 70,
        });
    }

    const updateSummary = input.downstreamUpdatePlanSummary;
    const preciseArtifactIds = new Set<string>();
    const preciseDefiniteArtifactIds = new Set<string>();
    for (const item of updateSummary?.blockingItems ?? []) {
        preciseArtifactIds.add(item.artifactId);
        preciseDefiniteArtifactIds.add(item.artifactId);
        upsert(updatePlanItem(item, true));
    }
    for (const item of updateSummary?.advisoryItems ?? []) {
        preciseArtifactIds.add(item.artifactId);
        upsert(updatePlanItem(item, false));
    }
    for (const alignment of input.outputAlignments ?? []) {
        const definite = alignment.state === 'stale' && alignment.confidence === 'definite';
        const preciseItemCoversThisStrength = preciseArtifactIds.has(alignment.artifactId)
            && (!definite || preciseDefiniteArtifactIds.has(alignment.artifactId));
        if (alignment.state === 'aligned' || preciseItemCoversThisStrength) continue;
        const legacy = alignment.confidence === 'unknown';
        upsert({
            key: legacy ? `legacy-artifact:${alignment.artifactId}` : `output:${alignment.artifactId}`,
            condition: legacy ? 'legacy_review' : definite ? 'update_required' : 'review_recommended',
            title: alignment.title,
            why: legacy
                ? 'Precise dependency history is unavailable. Review this output without assuming it is wrong.'
                : alignment.summary,
            actionLabel: definite ? 'Review required update' : 'Review output',
            destination: { kind: 'artifact', artifactId: alignment.artifactId, nodeId: alignment.nodeId },
            materiality: definite && alignment.blocksBuildReadiness ? 'blocking' : definite ? 'high' : 'normal',
            dependencyCount: alignment.reasons.length,
            actionableNow: true,
            sourceRefs: [{
                kind: legacy ? 'legacy_artifact' : 'output', id: alignment.artifactId,
                versionId: alignment.generatedFromSpineId,
            }],
            rank: definite ? 80 : legacy ? 95 : 90,
        });
    }

    if (readiness.nextAction.kind === 'commit_plan') {
        upsert({
            key: 'readiness:commit-current-plan', condition: 'ready_to_commit', title: 'Commit the plan',
            why: readiness.nextAction.detail, actionLabel: readiness.nextAction.label,
            destination: { kind: 'prd' }, materiality: 'normal', dependencyCount: 0,
            actionableNow: true, sourceRefs: [{ kind: 'readiness', id: 'live:commit' }], rank: 100,
        });
    }

    const candidates = sorted(byKey.values());
    const primaryKey = primaryKeyFor(readiness, candidates);
    const primary = primaryKey
        ? candidates.find(item => item.key === primaryKey)
        : candidates[0];
    const secondary = candidates.filter(item => item.key !== primary?.key).slice(0, 3);
    const visibleCount = (primary ? 1 : 0) + secondary.length;
    const stripRank = ({ rank: _rank, ...item }: RankedAttentionItem): PlanningAttentionItem => {
        void _rank;
        return item;
    };
    return {
        primary: primary ? stripRank(primary) : undefined,
        secondary: secondary.map(stripRank),
        totalCount: candidates.length,
        hiddenCount: Math.max(0, candidates.length - visibleCount),
        readiness,
    };
}
